import { describe, expect, it } from 'vitest';
import { downmixToMono, float32ToInt16PCM, int16ToBase64, resample } from './pcm';

describe('downmixToMono', () => {
  it('returns an empty array for no channels', () => {
    expect(downmixToMono([])).toEqual(new Float32Array(0));
  });

  it('returns the channel unchanged when there is only one', () => {
    const mono = new Float32Array([0.1, -0.2, 0.3]);
    expect(downmixToMono([mono])).toEqual(mono);
  });

  it('averages multiple channels sample-by-sample', () => {
    const left = new Float32Array([1, 0.5, -1]);
    const right = new Float32Array([-1, 0.5, 1]);
    expect(downmixToMono([left, right])).toEqual(new Float32Array([0, 0.5, 0]));
  });
});

describe('resample', () => {
  it('returns an equivalent copy when the rate is unchanged', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const output = resample(input, 24000, 24000);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it('returns an empty array for empty input', () => {
    expect(resample(new Float32Array(0), 48000, 24000)).toEqual(new Float32Array(0));
  });

  it('halves the sample count when downsampling by 2x', () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const output = resample(input, 48000, 24000);
    expect(output.length).toBe(4);
  });

  it('linearly interpolates between source samples when downsampling', () => {
    // 4 input samples at 2x the output rate -> every other input sample,
    // landing exactly on original values for this particular ratio.
    const input = new Float32Array([0, 10, 20, 30]);
    const output = resample(input, 48000, 24000);
    expect(Array.from(output)).toEqual([0, 20]);
  });

  it('doubles the sample count when upsampling by 2x', () => {
    const input = new Float32Array([0, 10]);
    const output = resample(input, 24000, 48000);
    expect(output.length).toBe(4);
    // First sample matches; interpolated points move smoothly toward the next source sample.
    expect(output[0]).toBe(0);
  });
});

describe('float32ToInt16PCM', () => {
  it('maps 0 to 0', () => {
    expect(float32ToInt16PCM(new Float32Array([0]))).toEqual(new Int16Array([0]));
  });

  it('maps 1 to the max positive int16 value', () => {
    expect(float32ToInt16PCM(new Float32Array([1]))[0]).toBe(0x7fff);
  });

  it('maps -1 to the min int16 value', () => {
    expect(float32ToInt16PCM(new Float32Array([-1]))[0]).toBe(-0x8000);
  });

  it('clamps values outside [-1, 1]', () => {
    const output = float32ToInt16PCM(new Float32Array([2, -2]));
    expect(output[0]).toBe(0x7fff);
    expect(output[1]).toBe(-0x8000);
  });
});

describe('int16ToBase64', () => {
  it('encodes samples as little-endian PCM16 bytes, base64-encoded', () => {
    // 1 -> bytes [0x01, 0x00]; -1 -> bytes [0xFF, 0xFF] (little-endian int16)
    const output = int16ToBase64(new Int16Array([1, -1]));
    expect(output).toBe('AQD//w==');
  });

  it('encodes an empty array as an empty string', () => {
    expect(int16ToBase64(new Int16Array(0))).toBe('');
  });
});
