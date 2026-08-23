import { browser } from 'wxt/browser';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type { CaptureFailureReason, KoemieruMessage } from '@/lib/messaging/protocol';

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

let activeStream: MediaStream | undefined;
let audioContext: AudioContext | undefined;
let pcmWorkletNode: AudioWorkletNode | undefined;
let isCapturing = false;
let pcmChunkCount = 0;

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
      void startCapture(message.streamId);
      return undefined;

    case 'STOP_CAPTURE':
      void stopCapture();
      return undefined;

    default:
      return undefined;
  }
});

async function startCapture(streamId: string): Promise<void> {
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

    // Processing tap: a second branch off the same source, feeding raw
    // Float32 frames to the main thread via pcm-worklet.js. Its output is
    // never connected onward — only its port messages are used — so it
    // doesn't affect what's audible.
    await ctx.audioWorklet.addModule(browser.runtime.getURL(PCM_WORKLET_URL));
    const workletNode = new AudioWorkletNode(ctx, PCM_WORKLET_PROCESSOR_NAME);
    source.connect(workletNode);
    pcmChunkCount = 0;
    workletNode.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
      pcmChunkCount++;
      // Conversion (lib/audio/pcm.ts) and streaming to OpenAI are wired in
      // Task 8 — for now just confirm a steady cadence without flooding
      // the console (one line/sec at the worklet's ~85ms batch size).
      if (pcmChunkCount % 12 === 1) {
        console.log('[offscreen] pcm chunk', pcmChunkCount, 'frames', event.data[0]?.length);
      }
    };

    activeStream = stream;
    audioContext = ctx;
    pcmWorkletNode = workletNode;
    isCapturing = true;

    console.log('[offscreen] capture started successfully');
    await broadcast({ type: 'CAPTURE_STARTED' });
  } catch (error) {
    console.error('[offscreen] getUserMedia failed', error);
    await broadcast({
      type: 'CAPTURE_FAILED',
      reason: classifyGetUserMediaError(error),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function stopCapture(): Promise<void> {
  if (pcmWorkletNode) {
    pcmWorkletNode.port.onmessage = null;
    pcmWorkletNode.disconnect();
    pcmWorkletNode = undefined;
  }

  if (audioContext) {
    await audioContext.close().catch((error) => console.error('Failed to close AudioContext', error));
    audioContext = undefined;
  }

  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
  isCapturing = false;

  await broadcast({ type: 'CAPTURE_STOPPED' });
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
