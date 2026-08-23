// Builds the WebSocket URL/subprotocols/payloads for OpenAI's Realtime
// transcription API and wraps a WebSocket-like object behind a small
// onDelta/onFinal/onError/onClose interface, so the protocol logic can be
// unit-tested against a fake socket instead of a real network connection.
//
// Auth: connects directly with the user's own API key via the
// "openai-insecure-api-key.<KEY>" WebSocket subprotocol — see
// docs/1-koemieru-mvp/design.md's Known Risks for why (no backend, an
// explicitly accepted risk).
//
// Session config/event shapes verified against
// https://developers.openai.com/api/docs/guides/realtime-transcription and
// https://developers.openai.com/api/docs/guides/realtime-vad on 2026-08-23
// — re-verify before trusting this if it's been a while, per CLAUDE.md's
// Verification Principles (OpenAI's realtime/transcription models and event
// shapes have churned before).
//
// Connection URL: `?model=<transcription model>` (e.g. gpt-live-transcribe)
// is REJECTED with "invalid_request_error.invalid_model" — confirmed by
// live testing on 2026-08-23. The official guides only ever show `?model=`
// with a *conversational* realtime model (gpt-realtime-*); the actual
// transcription model is selected separately via session.update's
// audio.input.transcription.model field. The working connection query
// parameter for a transcription session is the UNDOCUMENTED
// `?intent=transcription` — this isn't in OpenAI's official docs, only
// reported by other developers hitting the same error (see
// https://community.openai.com/t/missing-documentation-for-websocket-realtime-transcription-mode/1366640).
// Re-verify this against official docs if it starts failing — it could
// change or get formally documented/replaced at any time.
const DEFAULT_MODEL = 'gpt-live-transcribe';
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

export function buildRealtimeUrl(): string {
  return REALTIME_URL;
}

export function buildRealtimeSubprotocols(apiKey: string): string[] {
  return ['realtime', `openai-insecure-api-key.${apiKey}`];
}

export function buildSessionUpdatePayload(model: string = DEFAULT_MODEL): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model },
          // create_response/interrupt_response are only meaningful for
          // full conversational sessions, not transcription — omitted.
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  });
}

export function buildAppendAudioPayload(base64Audio: string): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Audio });
}

interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
}

export function parseRealtimeEvent(raw: string): RealtimeEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    typeof (parsed as { type: unknown }).type === 'string'
  ) {
    return parsed as RealtimeEvent;
  }
  return undefined;
}

export interface RealtimeSessionHandlers {
  onOpen?: () => void;
  onDelta?: (itemId: string, delta: string) => void;
  onFinal?: (itemId: string, transcript: string) => void;
  onError?: (error: unknown) => void;
  onClose?: (code: number, reason: string) => void;
}

/** The subset of the real WebSocket API this module depends on, so a fake
 * implementation can stand in for tests. */
export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export interface RealtimeSession {
  sendAudioChunk(base64Audio: string): void;
  close(): void;
}

function defaultWebSocketFactory(url: string, protocols: string[]): WebSocketLike {
  return new WebSocket(url, protocols) as unknown as WebSocketLike;
}

export function connectRealtimeSession(
  apiKey: string,
  handlers: RealtimeSessionHandlers,
  createWebSocket: WebSocketFactory = defaultWebSocketFactory,
  model: string = DEFAULT_MODEL,
): RealtimeSession {
  const ws = createWebSocket(buildRealtimeUrl(), buildRealtimeSubprotocols(apiKey));
  // The AudioWorklet tap starts posting chunks as soon as capture begins,
  // which can easily outrun the WebSocket handshake (a real network round
  // trip) — sendAudioChunk() must not call ws.send() before onopen fires,
  // or the browser throws InvalidStateError ("Still in CONNECTING state").
  let isOpen = false;

  ws.onopen = () => {
    isOpen = true;
    ws.send(buildSessionUpdatePayload(model));
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    const parsed = parseRealtimeEvent(event.data);
    if (!parsed) {
      console.warn('[realtimeSession] received unparseable message', event.data);
      return;
    }
    console.log('[realtimeSession] event', parsed.type, parsed);

    if (
      parsed.type === 'conversation.item.input_audio_transcription.delta' &&
      parsed.item_id !== undefined &&
      parsed.delta !== undefined
    ) {
      handlers.onDelta?.(parsed.item_id, parsed.delta);
    } else if (
      parsed.type === 'conversation.item.input_audio_transcription.completed' &&
      parsed.item_id !== undefined &&
      parsed.transcript !== undefined
    ) {
      handlers.onFinal?.(parsed.item_id, parsed.transcript);
    } else if (parsed.type === 'error') {
      console.error('[realtimeSession] server-sent error event', parsed);
    }
    // Other event types (session.created, session.updated, input audio
    // buffer speech_started/stopped, etc.) are intentionally not treated
    // as fatal — just not acted on here, but still logged above.
  };

  ws.onerror = (error) => handlers.onError?.(error);
  ws.onclose = (event) => {
    isOpen = false;
    handlers.onClose?.(event.code, event.reason);
  };

  return {
    sendAudioChunk(base64Audio: string): void {
      // Silently drop chunks that arrive before the handshake completes or
      // after the connection has closed — a few dropped leading frames are
      // an acceptable MVP trade-off (see docs/1-koemieru-mvp/requirements.md:
      // "some transcript lag is acceptable") versus buffering complexity.
      if (!isOpen) return;
      ws.send(buildAppendAudioPayload(base64Audio));
    },
    close(): void {
      ws.close();
    },
  };
}
