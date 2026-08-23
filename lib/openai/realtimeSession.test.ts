import { describe, expect, it, vi } from 'vitest';
import {
  buildAppendAudioPayload,
  buildCommitPayload,
  buildRealtimeSubprotocols,
  buildRealtimeUrl,
  buildSessionUpdatePayload,
  connectRealtimeSession,
  parseRealtimeEvent,
} from './realtimeSession';

describe('buildRealtimeUrl', () => {
  it('connects with intent=transcription, not a model query parameter', () => {
    // ?model=<transcription model> is rejected with invalid_model — the
    // model is selected via session.update instead. See the comment above
    // REALTIME_URL in realtimeSession.ts for how this was confirmed.
    expect(buildRealtimeUrl()).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
  });
});

describe('buildRealtimeSubprotocols', () => {
  it('embeds the API key in the openai-insecure-api-key subprotocol', () => {
    expect(buildRealtimeSubprotocols('sk-test-123')).toEqual([
      'realtime',
      'openai-insecure-api-key.sk-test-123',
    ]);
  });
});

describe('buildSessionUpdatePayload', () => {
  it('builds a transcription session config with turn detection disabled and 24kHz PCM', () => {
    // turn_detection (server VAD) is rejected by the API for this model —
    // "Turn detection is not supported for this transcription model"
    // (confirmed by live testing) — so it must be null, and the client
    // sends input_audio_buffer.commit manually instead (see commit()).
    const payload = JSON.parse(buildSessionUpdatePayload());
    expect(payload).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-live-transcribe' },
            turn_detection: null,
          },
        },
      },
    });
  });

  it('uses the given model', () => {
    const payload = JSON.parse(buildSessionUpdatePayload('gpt-transcribe'));
    expect(payload.session.audio.input.transcription.model).toBe('gpt-transcribe');
  });
});

describe('buildCommitPayload', () => {
  it('builds an input_audio_buffer.commit event', () => {
    expect(JSON.parse(buildCommitPayload())).toEqual({ type: 'input_audio_buffer.commit' });
  });
});

describe('buildAppendAudioPayload', () => {
  it('wraps base64 audio in an input_audio_buffer.append event', () => {
    expect(JSON.parse(buildAppendAudioPayload('AQD//w=='))).toEqual({
      type: 'input_audio_buffer.append',
      audio: 'AQD//w==',
    });
  });
});

describe('parseRealtimeEvent', () => {
  it('parses a well-formed event', () => {
    expect(parseRealtimeEvent('{"type":"session.created"}')).toEqual({ type: 'session.created' });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseRealtimeEvent('not json')).toBeUndefined();
  });

  it('returns undefined for JSON without a string type field', () => {
    expect(parseRealtimeEvent('{"foo":"bar"}')).toBeUndefined();
    expect(parseRealtimeEvent('{"type":42}')).toBeUndefined();
  });
});

/** A minimal fake standing in for the real WebSocket, so the session logic
 * can be tested without a network connection. */
function createFakeWebSocket() {
  const sent: string[] = [];
  const fake = {
    sent,
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as ((event: { code: number; reason: string }) => void) | null,
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
  };
  return fake;
}

describe('connectRealtimeSession', () => {
  it('sends the session config as soon as the socket opens', () => {
    const fakeWs = createFakeWebSocket();
    connectRealtimeSession('sk-test', {}, () => fakeWs);

    fakeWs.onopen?.();

    expect(fakeWs.sent).toHaveLength(1);
    expect(JSON.parse(fakeWs.sent[0]!)).toMatchObject({ type: 'session.update' });
  });

  it('calls onOpen once the session config has been sent', () => {
    const fakeWs = createFakeWebSocket();
    const onOpen = vi.fn();
    connectRealtimeSession('sk-test', { onOpen }, () => fakeWs);

    fakeWs.onopen?.();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('routes a delta event to onDelta with itemId and text', () => {
    const fakeWs = createFakeWebSocket();
    const onDelta = vi.fn();
    connectRealtimeSession('sk-test', { onDelta }, () => fakeWs);

    fakeWs.onmessage?.({
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'item_1',
        delta: 'Hel',
      }),
    });

    expect(onDelta).toHaveBeenCalledWith('item_1', 'Hel');
  });

  it('routes a completed event to onFinal with itemId and transcript', () => {
    const fakeWs = createFakeWebSocket();
    const onFinal = vi.fn();
    connectRealtimeSession('sk-test', { onFinal }, () => fakeWs);

    fakeWs.onmessage?.({
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item_1',
        transcript: 'Hello there',
      }),
    });

    expect(onFinal).toHaveBeenCalledWith('item_1', 'Hello there');
  });

  it('ignores unrecognized event types without throwing', () => {
    const fakeWs = createFakeWebSocket();
    const onDelta = vi.fn();
    const onFinal = vi.fn();
    connectRealtimeSession('sk-test', { onDelta, onFinal }, () => fakeWs);

    expect(() => fakeWs.onmessage?.({ data: JSON.stringify({ type: 'session.created' }) })).not.toThrow();
    expect(onDelta).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('forwards close events with code and reason', () => {
    const fakeWs = createFakeWebSocket();
    const onClose = vi.fn();
    connectRealtimeSession('sk-test', { onClose }, () => fakeWs);

    fakeWs.onclose?.({ code: 1006, reason: 'abnormal closure' });

    expect(onClose).toHaveBeenCalledWith(1006, 'abnormal closure');
  });

  it('forwards error events', () => {
    const fakeWs = createFakeWebSocket();
    const onError = vi.fn();
    connectRealtimeSession('sk-test', { onError }, () => fakeWs);

    const errorEvent = { message: 'boom' };
    fakeWs.onerror?.(errorEvent);

    expect(onError).toHaveBeenCalledWith(errorEvent);
  });

  it('sendAudioChunk sends an input_audio_buffer.append event once open', () => {
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);
    fakeWs.onopen?.();

    session.sendAudioChunk('AQD//w==');

    expect(JSON.parse(fakeWs.sent.at(-1)!)).toEqual({
      type: 'input_audio_buffer.append',
      audio: 'AQD//w==',
    });
  });

  it('sendAudioChunk drops chunks that arrive before the socket has opened', () => {
    // The AudioWorklet tap can start posting chunks before the WebSocket
    // handshake finishes; calling ws.send() before onopen throws
    // InvalidStateError in real browsers (confirmed by live testing).
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);

    session.sendAudioChunk('AQD//w==');

    expect(fakeWs.send).not.toHaveBeenCalled();
  });

  it('sendAudioChunk drops chunks after the socket has closed', () => {
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);
    fakeWs.onopen?.();
    fakeWs.onclose?.({ code: 1000, reason: '' });
    fakeWs.send.mockClear();

    session.sendAudioChunk('AQD//w==');

    expect(fakeWs.send).not.toHaveBeenCalled();
  });

  it('commit() sends an input_audio_buffer.commit event once open', () => {
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);
    fakeWs.onopen?.();

    session.commit();

    expect(JSON.parse(fakeWs.sent.at(-1)!)).toEqual({ type: 'input_audio_buffer.commit' });
  });

  it('commit() does nothing before the socket has opened', () => {
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);

    session.commit();

    expect(fakeWs.send).not.toHaveBeenCalled();
  });

  it('close() closes the underlying socket', () => {
    const fakeWs = createFakeWebSocket();
    const session = connectRealtimeSession('sk-test', {}, () => fakeWs);

    session.close();

    expect(fakeWs.close).toHaveBeenCalledOnce();
  });
});
