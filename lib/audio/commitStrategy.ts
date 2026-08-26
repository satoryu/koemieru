// Decides when entrypoints/offscreen/main.ts should send
// input_audio_buffer.commit (see lib/openai/realtimeSession.ts) — required
// since the transcription model rejects server-side turn detection
// (turn_detection). Two interchangeable strategies share the same
// interface so the side panel can switch between them for comparison on
// the same audio source (see lib/messaging/protocol.ts's CommitStrategyType
// and entrypoints/sidepanel/main.ts).

export interface CommitStrategy {
  /** Feed one chunk of audio (at its native/pre-resample sample rate) and
   * its duration; returns true if a commit should happen now. */
  shouldCommit(samples: Float32Array, chunkDurationMs: number): boolean;
  /** Call after every commit (whether triggered by this strategy or not,
   * e.g. the final flush on stop) to restart its internal timers. */
  reset(): void;
}

/**
 * Commits on a fixed wall-clock-independent cadence, regardless of audio
 * content — simple, but cuts mid-sentence as often as not, which hurts
 * transcription accuracy (each turn gets less coherent context).
 */
export function createFixedIntervalCommitStrategy(intervalMs = 6000): CommitStrategy {
  let elapsedMs = 0;

  return {
    shouldCommit(_samples, chunkDurationMs) {
      elapsedMs += chunkDurationMs;
      return elapsedMs >= intervalMs;
    },
    reset() {
      elapsedMs = 0;
    },
  };
}

export interface VadOptions {
  /** RMS amplitude below which a chunk is considered silence. */
  silenceThreshold?: number;
  /** How long silence must persist before triggering a commit. */
  silenceDurationMs?: number;
  /** Minimum turn duration before a silence-triggered commit is allowed —
   * avoids near-empty turns on a brief pause right after the last commit. */
  minTurnDurationMs?: number;
  /** Safety net: force a commit after this much audio even without
   * detected silence, so uninterrupted speech doesn't grow the turn (and
   * the transcript lag) without bound. */
  maxTurnDurationMs?: number;
}

/**
 * Commits at natural pauses in speech (simple RMS-energy-based silence
 * detection — not real VAD, but enough to avoid cutting mid-sentence).
 */
export function createVadCommitStrategy(options: VadOptions = {}): CommitStrategy {
  const silenceThreshold = options.silenceThreshold ?? 0.01;
  const silenceDurationMs = options.silenceDurationMs ?? 700;
  const minTurnDurationMs = options.minTurnDurationMs ?? 1000;
  const maxTurnDurationMs = options.maxTurnDurationMs ?? 15000;

  let turnMs = 0;
  let silenceMs = 0;

  function rms(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sumOfSquares = 0;
    for (const sample of samples) sumOfSquares += sample * sample;
    return Math.sqrt(sumOfSquares / samples.length);
  }

  return {
    shouldCommit(samples, chunkDurationMs) {
      turnMs += chunkDurationMs;

      const isSilent = rms(samples) < silenceThreshold;
      silenceMs = isSilent ? silenceMs + chunkDurationMs : 0;

      if (turnMs >= maxTurnDurationMs) return true;
      if (turnMs >= minTurnDurationMs && silenceMs >= silenceDurationMs) return true;
      return false;
    },
    reset() {
      turnMs = 0;
      silenceMs = 0;
    },
  };
}
