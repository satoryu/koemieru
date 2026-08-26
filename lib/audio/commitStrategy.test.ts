import { describe, expect, it } from 'vitest';
import { createFixedIntervalCommitStrategy, createVadCommitStrategy } from './commitStrategy';

function silence(length = 100): Float32Array {
  return new Float32Array(length); // all zeros
}

function speech(length = 100, amplitude = 0.5): Float32Array {
  // A simple non-silent waveform (alternating +amplitude/-amplitude), not
  // realistic speech, just something with RMS well above a silence threshold.
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = i % 2 === 0 ? amplitude : -amplitude;
  return samples;
}

describe('createFixedIntervalCommitStrategy', () => {
  it('does not commit before the interval has elapsed', () => {
    const strategy = createFixedIntervalCommitStrategy(1000);
    expect(strategy.shouldCommit(silence(), 400)).toBe(false);
    expect(strategy.shouldCommit(silence(), 400)).toBe(false);
  });

  it('commits once the accumulated duration reaches the interval', () => {
    const strategy = createFixedIntervalCommitStrategy(1000);
    strategy.shouldCommit(silence(), 400);
    strategy.shouldCommit(silence(), 400);
    expect(strategy.shouldCommit(silence(), 400)).toBe(true); // 1200ms >= 1000ms
  });

  it('ignores the audio content entirely (commits on speech or silence alike)', () => {
    const strategy = createFixedIntervalCommitStrategy(500);
    expect(strategy.shouldCommit(speech(), 600)).toBe(true);
  });

  it('restarts the count after reset()', () => {
    const strategy = createFixedIntervalCommitStrategy(1000);
    strategy.shouldCommit(silence(), 1000);
    strategy.reset();
    expect(strategy.shouldCommit(silence(), 400)).toBe(false);
  });
});

describe('createVadCommitStrategy', () => {
  it('does not commit while speech continues, even past the silence duration window', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 500,
      minTurnDurationMs: 0,
      maxTurnDurationMs: 60_000,
    });
    for (let i = 0; i < 5; i++) {
      expect(strategy.shouldCommit(speech(), 200)).toBe(false);
    }
  });

  it('commits once silence has persisted for at least silenceDurationMs', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 500,
      minTurnDurationMs: 0,
      maxTurnDurationMs: 60_000,
    });
    strategy.shouldCommit(speech(), 300); // some speech first
    expect(strategy.shouldCommit(silence(), 300)).toBe(false); // 300ms silence, not enough yet
    expect(strategy.shouldCommit(silence(), 300)).toBe(true); // 600ms silence total
  });

  it('resets the silence timer when speech resumes before the threshold', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 500,
      minTurnDurationMs: 0,
      maxTurnDurationMs: 60_000,
    });
    strategy.shouldCommit(speech(), 300);
    strategy.shouldCommit(silence(), 300); // 300ms silence
    strategy.shouldCommit(speech(), 100); // speech resumes — silence timer should reset
    expect(strategy.shouldCommit(silence(), 300)).toBe(false); // only 300ms silence since resuming
  });

  it('does not commit on a brief pause before minTurnDurationMs has elapsed', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 200,
      minTurnDurationMs: 2000,
      maxTurnDurationMs: 60_000,
    });
    strategy.shouldCommit(speech(), 300);
    expect(strategy.shouldCommit(silence(), 300)).toBe(false); // silence long enough, but turn is still short
  });

  it('force-commits once maxTurnDurationMs is reached even without silence (safety net)', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 999_999,
      minTurnDurationMs: 0,
      maxTurnDurationMs: 1000,
    });
    strategy.shouldCommit(speech(), 600);
    expect(strategy.shouldCommit(speech(), 600)).toBe(true); // 1200ms of continuous speech
  });

  it('restarts both timers after reset()', () => {
    const strategy = createVadCommitStrategy({
      silenceDurationMs: 500,
      minTurnDurationMs: 0,
      maxTurnDurationMs: 60_000,
    });
    strategy.shouldCommit(speech(), 300);
    strategy.shouldCommit(silence(), 300); // 300ms silence so far, not enough yet (needs 500)
    strategy.reset();
    // If reset() didn't clear the accumulated 300ms, this next 300ms chunk
    // would push the total past the 500ms threshold and commit.
    expect(strategy.shouldCommit(silence(), 300)).toBe(false);
  });
});
