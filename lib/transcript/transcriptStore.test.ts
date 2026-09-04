import { describe, expect, it } from 'vitest';
import { createTranscriptStore, transcriptStateToText } from './transcriptStore';

describe('createTranscriptStore', () => {
  it('starts empty', () => {
    const store = createTranscriptStore();
    expect(store.getState()).toEqual({ segments: [], inProgress: undefined });
  });

  it('accumulates deltas into the in-progress segment', () => {
    const store = createTranscriptStore();
    store.applyDelta('item_1', 'Hel');
    store.applyDelta('item_1', 'lo');

    expect(store.getState()).toEqual({
      segments: [],
      inProgress: { itemId: 'item_1', text: 'Hello' },
    });
  });

  it('moves the in-progress segment to finalized segments on final, using the final transcript text', () => {
    const store = createTranscriptStore();
    store.applyDelta('item_1', 'Hel');
    store.applyDelta('item_1', 'lo');
    store.applyFinal('item_1', 'Hello there');

    expect(store.getState()).toEqual({ segments: ['Hello there'], inProgress: undefined });
  });

  it('does not duplicate the finalized text when more deltas for the same item arrive afterward (late arrival)', () => {
    const store = createTranscriptStore();
    store.applyDelta('item_1', 'Hel');
    store.applyFinal('item_1', 'Hello');
    store.applyDelta('item_1', 'lo'); // late-arriving delta after finalization

    expect(store.getState()).toEqual({ segments: ['Hello'], inProgress: undefined });
  });

  it('ignores a duplicate final for an already-finalized item', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', 'Hello');
    store.applyFinal('item_1', 'Hello again');

    expect(store.getState().segments).toEqual(['Hello']);
  });

  it('accepts a final for an item it never saw any deltas for', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', 'Hello there');

    expect(store.getState()).toEqual({ segments: ['Hello there'], inProgress: undefined });
  });

  it('flushes a still-in-progress item as its own finalized segment when a new item starts (out-of-order resilience)', () => {
    const store = createTranscriptStore();
    store.applyDelta('item_1', 'First item text');
    store.applyDelta('item_2', 'Second');

    expect(store.getState()).toEqual({
      segments: ['First item text'],
      inProgress: { itemId: 'item_2', text: 'Second' },
    });
  });

  it('handles multiple finalized items building up in order', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', 'First.');
    store.applyFinal('item_2', 'Second.');

    expect(store.getState().segments).toEqual(['First.', 'Second.']);
  });

  it('tolerates an empty-string delta without corrupting state', () => {
    const store = createTranscriptStore();
    store.applyDelta('item_1', '');
    store.applyDelta('item_1', 'Hello');

    expect(store.getState().inProgress).toEqual({ itemId: 'item_1', text: 'Hello' });
  });

  it('does not add an empty finalized segment', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', '');

    expect(store.getState()).toEqual({ segments: [], inProgress: undefined });
  });

  it('reset() clears all segments and in-progress state', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', 'First.');
    store.applyDelta('item_2', 'Second');

    store.reset();

    expect(store.getState()).toEqual({ segments: [], inProgress: undefined });
  });

  it('reset() allows a previously-finalized itemId to be reused (new session)', () => {
    const store = createTranscriptStore();
    store.applyFinal('item_1', 'From an earlier session.');

    store.reset();
    store.applyFinal('item_1', 'From a new session.');

    expect(store.getState().segments).toEqual(['From a new session.']);
  });
});

describe('transcriptStateToText', () => {
  it('returns an empty string for empty state', () => {
    expect(transcriptStateToText({ segments: [], inProgress: undefined })).toBe('');
  });

  it('joins finalized segments with a blank line between them', () => {
    expect(
      transcriptStateToText({ segments: ['First.', 'Second.'], inProgress: undefined }),
    ).toBe('First.\n\nSecond.');
  });

  it('appends the in-progress text after the finalized segments', () => {
    expect(
      transcriptStateToText({
        segments: ['First.'],
        inProgress: { itemId: 'item_2', text: 'Second (partial' },
      }),
    ).toBe('First.\n\nSecond (partial');
  });

  it('includes only the in-progress text when there are no finalized segments yet', () => {
    expect(
      transcriptStateToText({ segments: [], inProgress: { itemId: 'item_1', text: 'Hel' } }),
    ).toBe('Hel');
  });
});
