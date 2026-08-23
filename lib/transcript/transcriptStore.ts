// Merges TRANSCRIPT_DELTA/TRANSCRIPT_FINAL events (see lib/messaging/protocol.ts)
// into renderable transcript state, without duplicating text — the core of
// the product's "append finalized text without duplicating content"
// requirement. Owned by the side panel (entrypoints/sidepanel/main.ts); the
// offscreen document forwards raw delta/final events unprocessed.

export interface TranscriptState {
  /** Finalized text segments, in the order they were finalized. */
  segments: string[];
  /** The currently in-progress (not yet finalized) segment, if any. */
  inProgress: { itemId: string; text: string } | undefined;
}

export interface TranscriptStore {
  applyDelta(itemId: string, delta: string): TranscriptState;
  applyFinal(itemId: string, transcript: string): TranscriptState;
  getState(): TranscriptState;
  /** Clears all state for a fresh session (e.g. on a new CAPTURE_STARTED). */
  reset(): void;
}

export function createTranscriptStore(): TranscriptStore {
  let segments: string[] = [];
  let finalizedItemIds = new Set<string>();
  let inProgressItemId: string | undefined;
  let inProgressText = '';

  function flushInProgress(): void {
    if (inProgressItemId !== undefined && inProgressText.length > 0) {
      finalizedItemIds.add(inProgressItemId);
      segments.push(inProgressText);
    }
    inProgressItemId = undefined;
    inProgressText = '';
  }

  function getState(): TranscriptState {
    return {
      segments: [...segments],
      inProgress: inProgressItemId !== undefined ? { itemId: inProgressItemId, text: inProgressText } : undefined,
    };
  }

  return {
    applyDelta(itemId: string, delta: string): TranscriptState {
      // A delta arriving after its item was already finalized (a late,
      // out-of-order message) must not reopen or duplicate that segment.
      if (finalizedItemIds.has(itemId)) return getState();

      if (inProgressItemId !== itemId) {
        // A different item started without an explicit final for the
        // previous one — finalize what we had rather than losing it.
        flushInProgress();
        inProgressItemId = itemId;
        inProgressText = '';
      }
      inProgressText += delta;
      return getState();
    },

    applyFinal(itemId: string, transcript: string): TranscriptState {
      if (finalizedItemIds.has(itemId)) return getState(); // duplicate/late final — ignore

      if (inProgressItemId === itemId) {
        inProgressItemId = undefined;
        inProgressText = '';
      }
      finalizedItemIds.add(itemId);
      // The `completed` event's transcript is the authoritative full text
      // for the item — used as-is rather than the accumulated deltas,
      // which may drift from it.
      if (transcript.length > 0) segments.push(transcript);
      return getState();
    },

    getState,

    reset(): void {
      segments = [];
      finalizedItemIds = new Set<string>();
      inProgressItemId = undefined;
      inProgressText = '';
    },
  };
}
