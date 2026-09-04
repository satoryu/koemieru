import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconnectingRealtimeSession } from './reconnectingSession';
import type { WebSocketLike } from './realtimeSession';

/** A minimal fake standing in for the real WebSocket — the same shape used
 * by realtimeSession.test.ts, but handed out by a factory so a reconnect
 * gets a fresh socket and the test can inspect each one separately. */
function createFakeWebSocket() {
  const sent: string[] = [];
  return {
    sent,
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onerror: null as ((error: unknown) => void) | null,
    onclose: null as ((event: { code: number; reason: string }) => void) | null,
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
  };
}

type FakeWebSocket = ReturnType<typeof createFakeWebSocket>;

function createFakeWebSocketFactory() {
  const sockets: FakeWebSocket[] = [];
  return {
    sockets,
    factory: (): WebSocketLike => {
      const socket = createFakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocketLike;
    },
    /** The socket handed out for the most recent connection attempt. */
    latest: (): FakeWebSocket => sockets[sockets.length - 1]!,
  };
}

/** The append payloads a socket received, in order — the session config and
 * commit events are filtered out so buffering order is easy to assert on. */
function appendedAudio(socket: FakeWebSocket): string[] {
  return socket.sent
    .map((raw) => JSON.parse(raw) as { type: string; audio?: string })
    .filter((event) => event.type === 'input_audio_buffer.append')
    .map((event) => event.audio!);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createReconnectingRealtimeSession', () => {
  it('delegates sendAudioChunk and commit to the live connection while it is open', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession('sk-test', {}, { createWebSocket: ws.factory });
    ws.latest().onopen?.();

    session.sendAudioChunk('AQD//w==');
    expect(JSON.parse(ws.latest().sent.at(-1)!)).toEqual({
      type: 'input_audio_buffer.append',
      audio: 'AQD//w==',
    });

    session.commit();
    expect(JSON.parse(ws.latest().sent.at(-1)!)).toEqual({ type: 'input_audio_buffer.commit' });
  });

  it('reports an unexpected close as a reconnect attempt rather than the end of the session', () => {
    const ws = createFakeWebSocketFactory();
    const onReconnecting = vi.fn();
    const onClose = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onReconnecting, onClose },
      { createWebSocket: ws.factory },
    );
    ws.latest().onopen?.();

    ws.latest().onclose?.({ code: 1006, reason: 'gone' });

    expect(onReconnecting).toHaveBeenCalledWith(1, 6, 'gone');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens a fresh connection once the backoff delay has elapsed', () => {
    const ws = createFakeWebSocketFactory();
    const onOpen = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onOpen },
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });

    vi.advanceTimersByTime(499);
    expect(ws.sockets).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(ws.sockets).toHaveLength(2);

    ws.latest().onopen?.();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('waits longer before each successive attempt', () => {
    const ws = createFakeWebSocketFactory();
    createReconnectingRealtimeSession(
      'sk-test',
      {},
      { createWebSocket: ws.factory, backoffMs: [100, 900], maxAttempts: 2 },
    );
    ws.latest().onopen?.();

    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(100);
    expect(ws.sockets).toHaveLength(2);

    // The second attempt's socket never opens, so the next wait uses the
    // second backoff entry rather than repeating the first.
    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(100);
    expect(ws.sockets).toHaveLength(2);

    vi.advanceTimersByTime(800);
    expect(ws.sockets).toHaveLength(3);
  });

  it('ends the session after exhausting every attempt, calling onClose exactly once', () => {
    const ws = createFakeWebSocketFactory();
    const onClose = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onClose },
      { createWebSocket: ws.factory, backoffMs: [100, 200], maxAttempts: 2 },
    );
    ws.latest().onopen?.();

    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(100);
    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(200);
    expect(ws.sockets).toHaveLength(3);
    expect(onClose).not.toHaveBeenCalled();

    ws.latest().onclose?.({ code: 1006, reason: 'still failing' });

    expect(onClose).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(ws.sockets).toHaveLength(3); // no further attempts
  });

  it.each([
    ['invalid_api_key', 'invalid_request_error'],
    ['credit_balance_exhausted', 'insufficient_quota'],
  ])('does not retry after a non-retryable server error (%s)', (code, errorType) => {
    const ws = createFakeWebSocketFactory();
    const onClose = vi.fn();
    const onReconnecting = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onClose, onReconnecting },
      { createWebSocket: ws.factory },
    );
    ws.latest().onopen?.();

    ws.latest().onmessage?.({
      data: JSON.stringify({ type: 'error', error: { code, type: errorType, message: 'Nope.' } }),
    });
    ws.latest().onclose?.({ code: 1000, reason: '' });

    expect(onReconnecting).not.toHaveBeenCalled();
    // The close event's own reason is typically blank, so the server error's
    // message is what reaches the user.
    expect(onClose).toHaveBeenCalledWith(1000, 'Nope.');
    vi.advanceTimersByTime(60_000);
    expect(ws.sockets).toHaveLength(1);
  });

  it('retries after a server error that is not on the non-retryable list', () => {
    const ws = createFakeWebSocketFactory();
    const onReconnecting = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onReconnecting },
      { createWebSocket: ws.factory },
    );
    ws.latest().onopen?.();

    // OpenAI doesn't document the error it sends when a session hits its
    // 60-minute limit, so anything not explicitly known-hopeless must retry.
    ws.latest().onmessage?.({
      data: JSON.stringify({
        type: 'error',
        error: { code: 'session_expired', type: 'server_error', message: 'Session ended.' },
      }),
    });
    ws.latest().onclose?.({ code: 1000, reason: '' });

    expect(onReconnecting).toHaveBeenCalledWith(1, 6, 'Session ended.');
  });

  it('does not reconnect after close(), and cancels an attempt already scheduled', () => {
    const ws = createFakeWebSocketFactory();
    const onClose = vi.fn();
    const session = createReconnectingRealtimeSession(
      'sk-test',
      { onClose },
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' }); // reconnect now pending

    session.close();

    vi.advanceTimersByTime(60_000);
    expect(ws.sockets).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled(); // a deliberate stop isn't a session failure
  });

  it('closes the live socket on close()', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession('sk-test', {}, { createWebSocket: ws.factory });
    ws.latest().onopen?.();

    session.close();

    expect(ws.latest().close).toHaveBeenCalledOnce();
  });

  it('buffers audio received while disconnected and replays it in order once reconnected', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession(
      'sk-test',
      {},
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });

    // The audio pipeline keeps running through the outage — these chunks
    // would otherwise be lost, taking the speech in the gap with them.
    session.sendAudioChunk('one');
    session.sendAudioChunk('two');

    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();

    expect(appendedAudio(ws.latest())).toEqual(['one', 'two']);
  });

  it('sends buffered audio before any chunk that arrives after reconnecting', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession(
      'sk-test',
      {},
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });
    session.sendAudioChunk('buffered');

    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();
    session.sendAudioChunk('live');

    expect(appendedAudio(ws.latest())).toEqual(['buffered', 'live']);
  });

  it('drops the oldest buffered audio once the buffer is full', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession(
      'sk-test',
      {},
      { createWebSocket: ws.factory, backoffMs: [500], maxBufferedChunks: 2 },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });

    session.sendAudioChunk('oldest');
    session.sendAudioChunk('middle');
    session.sendAudioChunk('newest');

    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();

    expect(appendedAudio(ws.latest())).toEqual(['middle', 'newest']);
  });

  it('starts the attempt count over once a connection has stayed open long enough', () => {
    const ws = createFakeWebSocketFactory();
    const onReconnecting = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onReconnecting },
      {
        createWebSocket: ws.factory,
        backoffMs: [100, 200],
        maxAttempts: 2,
        stableConnectionMs: 1000,
      },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });
    expect(onReconnecting).toHaveBeenLastCalledWith(1, 2, undefined);

    vi.advanceTimersByTime(100);
    ws.latest().onopen?.();
    vi.advanceTimersByTime(1000); // this connection proved itself

    ws.latest().onclose?.({ code: 1006, reason: '' });

    // Counting from 1 again, rather than 2 — so a long session that drops
    // once an hour never runs out of attempts.
    expect(onReconnecting).toHaveBeenLastCalledWith(1, 2, undefined);
  });

  it('does not credit a short-lived connection towards the stability reset', () => {
    const ws = createFakeWebSocketFactory();
    const onReconnecting = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onReconnecting },
      {
        createWebSocket: ws.factory,
        backoffMs: [100, 200],
        maxAttempts: 2,
        stableConnectionMs: 1000,
      },
    );
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: '' });

    vi.advanceTimersByTime(100);
    ws.latest().onopen?.();
    vi.advanceTimersByTime(999); // one tick short of stable
    ws.latest().onclose?.({ code: 1006, reason: '' });

    expect(onReconnecting).toHaveBeenLastCalledWith(2, 2, undefined);
  });

  it('namespaces item ids per connection so a reused id is not mistaken for a duplicate', () => {
    const ws = createFakeWebSocketFactory();
    const onDelta = vi.fn();
    const onFinal = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onDelta, onFinal },
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onmessage?.({
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'item_1',
        delta: 'before',
      }),
    });

    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();
    ws.latest().onmessage?.({
      data: JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item_1',
        transcript: 'after',
      }),
    });

    // Same item_id from the new session — the transcript store would drop
    // the second one as an already-finalized duplicate without this prefix.
    expect(onDelta).toHaveBeenCalledWith('0:item_1', 'before');
    expect(onFinal).toHaveBeenCalledWith('1:item_1', 'after');
  });

  it('calls onReconnected only after a re-open, not on the first connection', () => {
    const ws = createFakeWebSocketFactory();
    const onReconnected = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onReconnected },
      { createWebSocket: ws.factory, backoffMs: [500] },
    );

    ws.latest().onopen?.();
    expect(onReconnected).not.toHaveBeenCalled();

    ws.latest().onclose?.({ code: 1006, reason: '' });
    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();

    expect(onReconnected).toHaveBeenCalledOnce();
  });

  it('forwards server errors to onServerError as they arrive', () => {
    const ws = createFakeWebSocketFactory();
    const onServerError = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onServerError },
      { createWebSocket: ws.factory },
    );
    ws.latest().onopen?.();

    ws.latest().onmessage?.({
      data: JSON.stringify({
        type: 'error',
        error: { code: 'server_error', type: 'server_error', message: 'Transient.' },
      }),
    });

    expect(onServerError).toHaveBeenCalledWith('Transient.', 'server_error', 'server_error');
  });

  it('does not let an error from one connection condemn the next', () => {
    const ws = createFakeWebSocketFactory();
    const onClose = vi.fn();
    const onReconnecting = vi.fn();
    createReconnectingRealtimeSession(
      'sk-test',
      { onClose, onReconnecting },
      { createWebSocket: ws.factory, backoffMs: [500] },
    );
    ws.latest().onopen?.();
    ws.latest().onmessage?.({
      data: JSON.stringify({ type: 'error', error: { code: 'server_error', message: 'Transient.' } }),
    });
    ws.latest().onclose?.({ code: 1006, reason: '' });

    vi.advanceTimersByTime(500);
    ws.latest().onopen?.();
    ws.latest().onclose?.({ code: 1006, reason: 'plain drop' });

    // The stale "Transient." message must not be reported as this close's
    // reason, and must not influence the retry decision either.
    expect(onReconnecting).toHaveBeenLastCalledWith(2, 6, 'plain drop');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores audio sent after the session has ended', () => {
    const ws = createFakeWebSocketFactory();
    const session = createReconnectingRealtimeSession('sk-test', {}, { createWebSocket: ws.factory });
    ws.latest().onopen?.();
    session.close();
    ws.latest().send.mockClear();

    expect(() => {
      session.sendAudioChunk('late');
      session.commit();
    }).not.toThrow();
    expect(ws.latest().send).not.toHaveBeenCalled();
  });
});
