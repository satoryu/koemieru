// Loaded via AudioContext.audioWorklet.addModule() from
// entrypoints/offscreen/main.ts. Runs in the AudioWorkletGlobalScope, which
// has no access to most window/DOM APIs — this is why it's a plain static
// asset under public/ (copied as-is by WXT) rather than a normal TS module
// bundled through Vite: WXT has no first-class "worklet" entrypoint type,
// and running an AudioWorklet module through the regular bundler pipeline
// risks Vite/HMR transforms that assume a window-like global scope.
//
// Batches raw Float32 frames into ~85ms chunks (at 48kHz) before posting
// them to the main thread, rather than posting on every ~2.7ms render
// quantum — keeps postMessage traffic and downstream console logging
// reasonable, and lands close to the ~100-250ms chunk cadence used for
// streaming to OpenAI (see lib/audio/pcm.ts and entrypoints/offscreen/main.ts).
const BUFFER_SIZE = 4096;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.bufferedLength = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      // process() reuses its underlying buffers across calls — clone the
      // channel data before holding onto it.
      this.buffers.push(input.map((channel) => channel.slice()));
      this.bufferedLength += input[0].length;

      if (this.bufferedLength >= BUFFER_SIZE) {
        this.port.postMessage(this.mergeBuffers(input.length));
        this.buffers = [];
        this.bufferedLength = 0;
      }
    }
    return true; // keep the processor alive
  }

  mergeBuffers(channelCount) {
    const merged = [];
    for (let c = 0; c < channelCount; c++) {
      const channelData = new Float32Array(this.bufferedLength);
      let offset = 0;
      for (const chunk of this.buffers) {
        channelData.set(chunk[c], offset);
        offset += chunk[c].length;
      }
      merged.push(channelData);
    }
    return merged;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
