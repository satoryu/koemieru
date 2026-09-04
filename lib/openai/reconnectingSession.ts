// Keeps a transcription session alive across connection drops by rebuilding
// the WebSocket underneath, without the caller having to know it happened.
//
// Why this exists: an OpenAI Realtime session is capped at 60 minutes, with
// no documented way to extend one — reconnecting is the only option (see
// docs/2-auto-reconnect/requirements.md). A 90-minute lecture would
// otherwise stop transcribing partway through with no warning.
//
// This wraps lib/openai/realtimeSession.ts's connectRealtimeSession(), which
// stays a single-connection primitive that knows nothing about reconnecting.
// The audio pipeline in entrypoints/offscreen/main.ts is untouched by a drop
// — the tab stays audible and the tabCapture grant (which needs a user
// gesture and so can't be re-acquired on our own) is never given up.

import { connectRealtimeSession } from './realtimeSession';
import type { RealtimeSession, WebSocketFactory } from './realtimeSession';

/** Error codes/types that will never succeed on a retry — reconnecting after
 * one of these just burns attempts while the user waits for an explanation.
 * Everything NOT listed here is retried: OpenAI doesn't document what it
 * sends when a session hits its 60-minute limit, so treating unknown errors
 * as fatal would defeat the whole purpose of this module. */
const NON_RETRYABLE_ERROR_CODES = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'credit_balance_exhausted',
  'invalid_model',
]);

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const DEFAULT_STABLE_CONNECTION_MS = 10_000;
// pcm-worklet.js posts roughly one chunk per 85ms, so ~120 chunks is ~10s of
// audio — enough to cover a short outage and the first few backoff waits.
const DEFAULT_MAX_BUFFERED_CHUNKS = 120;

export interface ReconnectingSessionOptions {
  /** How many times to rebuild the connection before giving up. */
  maxAttempts?: number;
  /** Wait before the nth attempt. The last entry repeats if attempts outrun it. */
  backoffMs?: number[];
  /** A connection open at least this long is considered healthy, which
   * resets the attempt count — so an hourly drop over a long session never
   * exhausts it, while a connection that dies immediately every time still
   * gives up after maxAttempts. */
  stableConnectionMs?: number;
  /** Cap on audio chunks held while disconnected; the oldest are dropped. */
  maxBufferedChunks?: number;
  createWebSocket?: WebSocketFactory;
  model?: string;
}

export interface ReconnectingSessionHandlers {
  /** Fires on the first connection AND on every successful reconnect. */
  onOpen?: () => void;
  /** A drop that will be retried. `attempt` is 1-based. */
  onReconnecting?: (attempt: number, maxAttempts: number, reason?: string) => void;
  /** A reconnect succeeded (never fires for the first connection). */
  onReconnected?: () => void;
  /** Item ids are prefixed with the connection generation — see connect(). */
  onDelta?: (itemId: string, delta: string) => void;
  onFinal?: (itemId: string, transcript: string) => void;
  onError?: (error: unknown) => void;
  onServerError?: (message: string, code?: string, errorType?: string) => void;
  /** The session is over: retries are exhausted or the error was fatal.
   * NOT called for a deliberate close() — that's the caller's own doing. */
  onClose?: (code: number, reason: string) => void;
}

interface ServerError {
  message: string;
  code?: string;
  errorType?: string;
}

function isNonRetryable(error: ServerError): boolean {
  return (
    (error.code !== undefined && NON_RETRYABLE_ERROR_CODES.has(error.code)) ||
    (error.errorType !== undefined && NON_RETRYABLE_ERROR_CODES.has(error.errorType))
  );
}

export function createReconnectingRealtimeSession(
  apiKey: string,
  handlers: ReconnectingSessionHandlers,
  options: ReconnectingSessionOptions = {},
): RealtimeSession {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const stableConnectionMs = options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS;
  const maxBufferedChunks = options.maxBufferedChunks ?? DEFAULT_MAX_BUFFERED_CHUNKS;

  let session: RealtimeSession | undefined;
  let isOpen = false;
  /** Set once the session is over for good — by close(), by exhausting the
   * attempts, or by a fatal error. Makes onClose fire at most once. */
  let isFinished = false;
  let attempt = 0;
  let generation = 0;
  /** The last server-sent error on the CURRENT connection only; cleared on
   * every new attempt so a stale message can't be blamed for a later drop. */
  let lastServerError: ServerError | undefined;
  let pendingChunks: string[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  function flushPendingChunks(): void {
    if (pendingChunks.length === 0) return;
    console.log('[reconnectingSession] replaying', pendingChunks.length, 'buffered chunks');
    const buffered = pendingChunks;
    pendingChunks = [];
    // Synchronous, so nothing the AudioWorklet posts later can overtake it.
    for (const chunk of buffered) session?.sendAudioChunk(chunk);
  }

  function connect(): void {
    lastServerError = undefined;
    session = connectRealtimeSession(
      apiKey,
      {
        onOpen: () => {
          isOpen = true;
          stableTimer = setTimeout(() => {
            attempt = 0;
          }, stableConnectionMs);
          flushPendingChunks();
          handlers.onOpen?.();
          if (generation > 0) handlers.onReconnected?.();
        },
        // Each connection is a new session upstream, which restarts item
        // numbering. If an id were reused, lib/transcript/transcriptStore.ts
        // would silently discard the new segment as an already-finalized
        // duplicate — prefixing the generation makes that impossible.
        onDelta: (itemId, delta) => handlers.onDelta?.(`${generation}:${itemId}`, delta),
        onFinal: (itemId, transcript) => handlers.onFinal?.(`${generation}:${itemId}`, transcript),
        onError: (error) => handlers.onError?.(error),
        onServerError: (message, code, errorType) => {
          lastServerError = { message, code, errorType };
          handlers.onServerError?.(message, code, errorType);
        },
        onClose: (code, reason) => handleClose(code, reason),
      },
      options.createWebSocket,
      options.model,
    );
  }

  function handleClose(code: number, reason: string): void {
    isOpen = false;
    clearTimeout(stableTimer);
    session = undefined;

    if (isFinished) return; // deliberate close(), or already given up

    // CloseEvent.reason is nearly always blank (a web-platform restriction),
    // so a preceding server-sent error is usually the only human-readable
    // explanation available.
    const detail = lastServerError?.message ?? (reason || undefined);

    if (lastServerError && isNonRetryable(lastServerError)) {
      console.warn('[reconnectingSession] not retrying:', lastServerError.code, detail);
      finish(code, detail ?? reason);
      return;
    }

    if (attempt >= maxAttempts) {
      console.warn('[reconnectingSession] giving up after', maxAttempts, 'attempts');
      finish(code, detail ?? reason);
      return;
    }

    attempt++;
    const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
    console.log('[reconnectingSession] reconnecting', { attempt, maxAttempts, delay, detail });
    handlers.onReconnecting?.(attempt, maxAttempts, detail);
    reconnectTimer = setTimeout(() => {
      generation++;
      connect();
    }, delay);
  }

  function finish(code: number, reason: string): void {
    isFinished = true;
    pendingChunks = [];
    handlers.onClose?.(code, reason);
  }

  connect();

  return {
    sendAudioChunk(base64Audio: string): void {
      if (isFinished) return;
      if (session && isOpen) {
        session.sendAudioChunk(base64Audio);
        return;
      }
      // Disconnected: hold onto it so the speech in the gap survives the
      // reconnect. Beyond the cap the oldest goes, since the newest audio is
      // the part still worth transcribing.
      pendingChunks.push(base64Audio);
      if (pendingChunks.length > maxBufferedChunks) pendingChunks.shift();
    },

    commit(): void {
      // Dropped while disconnected on purpose: the server-side buffer a
      // commit would finalize died with the old connection.
      if (isFinished || !isOpen) return;
      session?.commit();
    },

    close(): void {
      isFinished = true;
      clearTimeout(reconnectTimer);
      clearTimeout(stableTimer);
      pendingChunks = [];
      session?.close();
      session = undefined;
    },
  };
}
