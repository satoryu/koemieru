import { browser } from 'wxt/browser';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type { CaptureFailureReason, KoemieruMessage } from '@/lib/messaging/protocol';
import { downmixToMono, float32ToInt16PCM, int16ToBase64, resample } from '@/lib/audio/pcm';
import { connectRealtimeSession } from '@/lib/openai/realtimeSession';
import type { RealtimeSession } from '@/lib/openai/realtimeSession';

// Chrome's tab-capture constraint shape is a non-standard, Chrome-only
// extension to MediaStreamConstraints (the `mandatory`/`chromeMediaSource`
// keys aren't part of the DOM lib types), hence the local type + cast.
// See: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
interface TabCaptureConstraints {
  audio: {
    mandatory: {
      chromeMediaSource: 'tab';
      chromeMediaSourceId: string;
    };
  };
}

const PCM_WORKLET_URL = '/pcm-worklet.js';
const PCM_WORKLET_PROCESSOR_NAME = 'pcm-capture-processor';
const OPENAI_INPUT_SAMPLE_RATE = 24000;
// Turn detection (server VAD) is rejected by the API for this transcription
// model, so we commit turns on a fixed cadence instead of relying on
// speech-boundary detection — see lib/openai/realtimeSession.ts's
// buildSessionUpdatePayload for the full explanation.
const COMMIT_INTERVAL_MS = 2000;

let activeStream: MediaStream | undefined;
let audioContext: AudioContext | undefined;
let pcmWorkletNode: AudioWorkletNode | undefined;
let realtimeSession: RealtimeSession | undefined;
let isCapturing = false;
let pcmChunkCount = 0;
let lastCommitAt = 0;

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isKoemieruMessage(message)) return undefined;
  console.log('[offscreen] received message', message.type);

  switch (message.type) {
    case 'ENSURE_OFFSCREEN_READY':
      // Synchronous ack: this document being alive and listening *is* the
      // readiness signal background.ts is polling for.
      sendResponse({});
      return undefined;

    case 'START_CAPTURE':
      void startCapture(message.streamId, message.apiKey);
      return undefined;

    case 'STOP_CAPTURE':
      void stopCapture();
      return undefined;

    default:
      return undefined;
  }
});

async function startCapture(streamId: string, apiKey: string): Promise<void> {
  console.log('[offscreen] startCapture', { streamId });

  if (isCapturing) {
    console.warn('[offscreen] startCapture called while already capturing');
    await broadcast({ type: 'CAPTURE_FAILED', reason: 'UNKNOWN', detail: 'Already capturing.' });
    return;
  }

  try {
    const constraints: TabCaptureConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(
      constraints as unknown as MediaStreamConstraints,
    );

    // Capturing a tab silences it for the user by default; reconnect it to
    // this document's own destination to restore audibility.
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(ctx.destination);

    activeStream = stream;
    audioContext = ctx;
    isCapturing = true;

    console.log('[offscreen] capture started successfully');
    await broadcast({ type: 'CAPTURE_STARTED' });

    // Connect to OpenAI before wiring the PCM tap, so sendAudioChunk has
    // somewhere to send to as soon as chunks start arriving.
    await broadcast({ type: 'WS_CONNECTING' });
    realtimeSession = connectRealtimeSession(apiKey, {
      onOpen: () => {
        console.log('[offscreen] realtime session open');
        void broadcast({ type: 'WS_OPEN' });
      },
      onDelta: (itemId, delta) => {
        void broadcast({ type: 'TRANSCRIPT_DELTA', itemId, delta });
      },
      onFinal: (itemId, transcript) => {
        void broadcast({ type: 'TRANSCRIPT_FINAL', itemId, transcript });
      },
      onError: (error) => {
        // WebSocket error events carry no diagnostic detail by design (a
        // web-platform privacy restriction) — the browser always follows
        // this with a close event, which is where teardown+status happen.
        console.error('[offscreen] realtime session error', error);
      },
      onClose: (code, reason) => {
        console.log('[offscreen] realtime session closed', { code, reason });
        if (!isCapturing) return; // already torn down via a deliberate stopCapture()
        teardownAudioResources();
        void broadcast({ type: 'WS_CLOSED', code, reason });
      },
    });

    // Processing tap: a second branch off the same source, feeding raw
    // Float32 frames to the main thread via pcm-worklet.js. Its output is
    // never connected onward — only its port messages are used — so it
    // doesn't affect what's audible.
    await ctx.audioWorklet.addModule(browser.runtime.getURL(PCM_WORKLET_URL));
    const workletNode = new AudioWorkletNode(ctx, PCM_WORKLET_PROCESSOR_NAME);
    source.connect(workletNode);
    pcmChunkCount = 0;
    lastCommitAt = Date.now();
    workletNode.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
      pcmChunkCount++;
      if (pcmChunkCount % 12 === 1) {
        console.log('[offscreen] pcm chunk', pcmChunkCount, 'frames', event.data[0]?.length);
      }

      const mono = downmixToMono(event.data);
      const resampled = resample(mono, ctx.sampleRate, OPENAI_INPUT_SAMPLE_RATE);
      const pcm16 = float32ToInt16PCM(resampled);
      realtimeSession?.sendAudioChunk(int16ToBase64(pcm16));

      const now = Date.now();
      if (now - lastCommitAt >= COMMIT_INTERVAL_MS) {
        console.log('[offscreen] committing audio turn');
        realtimeSession?.commit();
        lastCommitAt = now;
      }
    };
    pcmWorkletNode = workletNode;
  } catch (error) {
    console.error('[offscreen] failed to start capture', error);
    teardownAudioResources();
    await broadcast({
      type: 'CAPTURE_FAILED',
      reason: classifyGetUserMediaError(error),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function stopCapture(): Promise<void> {
  // Flush any trailing buffered-but-uncommitted audio so the last few
  // seconds of a session aren't silently lost.
  realtimeSession?.commit();
  realtimeSession?.close();
  teardownAudioResources();
  await broadcast({ type: 'CAPTURE_STOPPED' });
}

/** Releases every resource startCapture() may have acquired. Safe to call
 * even if some of them were never set up (e.g. failed partway through). */
function teardownAudioResources(): void {
  if (pcmWorkletNode) {
    pcmWorkletNode.port.onmessage = null;
    pcmWorkletNode.disconnect();
    pcmWorkletNode = undefined;
  }

  if (audioContext) {
    audioContext.close().catch((error) => console.error('Failed to close AudioContext', error));
    audioContext = undefined;
  }

  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
  realtimeSession = undefined;
  isCapturing = false;
}

function classifyGetUserMediaError(error: unknown): CaptureFailureReason {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'PERMISSION_DENIED';
    }
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError') {
      return 'STREAM_ID_EXPIRED';
    }
  }
  return 'UNKNOWN';
}

function broadcast(message: KoemieruMessage): Promise<unknown> {
  console.log('[offscreen] broadcasting', message.type);
  // No listener (e.g. the side panel is closed) rejects with "Could not
  // establish connection" — safe to ignore, this is a fire-and-forget event.
  return browser.runtime.sendMessage(message).catch((error) => {
    console.warn('[offscreen] broadcast had no receiver (may be expected)', message.type, error);
  });
}
