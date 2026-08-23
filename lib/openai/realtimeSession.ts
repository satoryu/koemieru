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

const DEFAULT_MODEL = 'gpt-live-transcribe';
const REALTIME_URL_BASE = 'wss://api.openai.com/v1/realtime';

export function buildRealtimeUrl(model: string = DEFAULT_MODEL): string {
  return `${REALTIME_URL_BASE}?model=${encodeURIComponent(model)}`;
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
  const ws = createWebSocket(buildRealtimeUrl(model), buildRealtimeSubprotocols(apiKey));

  ws.onopen = () => {
    ws.send(buildSessionUpdatePayload(model));
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    const parsed = parseRealtimeEvent(event.data);
    if (!parsed) return;

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
    }
    // Other event types (session.created, errors, etc.) are intentionally
    // not treated as fatal — just not acted on here.
  };

  ws.onerror = (error) => handlers.onError?.(error);
  ws.onclose = (event) => handlers.onClose?.(event.code, event.reason);

  return {
    sendAudioChunk(base64Audio: string): void {
      ws.send(buildAppendAudioPayload(base64Audio));
    },
    close(): void {
      ws.close();
    },
  };
}
