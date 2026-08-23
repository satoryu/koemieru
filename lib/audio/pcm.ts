// Pure audio-conversion helpers with no chrome/browser API dependency, so
// they can be unit-tested directly. Used by entrypoints/offscreen/main.ts
// to turn captured tab audio (Web Audio API Float32 frames, typically at
// the tab's native sample rate) into the PCM16/24kHz/mono/base64 format
// OpenAI's Realtime API expects.

/** Averages same-length channels sample-by-sample into a single mono channel. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;

  const output = new Float32Array(first.length);
  for (let i = 0; i < first.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i]!;
    output[i] = sum / channels.length;
  }
  return output;
}

/**
 * Linear-interpolation resampler. Adequate for this MVP's transcription use
 * case, not a high-fidelity resampler — see docs/1-koemieru-mvp/design.md's
 * Known Risks.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);

  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const indexBefore = Math.floor(sourceIndex);
    const indexAfter = Math.min(indexBefore + 1, input.length - 1);
    const fraction = sourceIndex - indexBefore;
    const before = input[indexBefore]!;
    const after = input[indexAfter]!;
    output[i] = before + (after - before) * fraction;
  }

  return output;
}

/** Converts Web Audio's [-1, 1] Float32 samples to clamped 16-bit PCM. */
export function float32ToInt16PCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]!));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

/**
 * Encodes PCM16 samples as little-endian bytes (the format OpenAI's
 * Realtime API expects — see design.md), base64-encoded for
 * `input_audio_buffer.append`. Uses DataView with explicit
 * littleEndian:true rather than reading the typed array's raw buffer, so
 * the output doesn't depend on the host platform's native endianness.
 */
export function int16ToBase64(input: Int16Array): string {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    view.setInt16(i * 2, input[i]!, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
