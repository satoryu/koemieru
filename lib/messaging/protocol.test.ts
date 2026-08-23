import { describe, expect, it } from 'vitest';
import { isKoemieruMessage, isMessageOfType } from './protocol';

describe('isKoemieruMessage', () => {
  it('accepts an object with a string type field', () => {
    expect(isKoemieruMessage({ type: 'STOP_CAPTURE' })).toBe(true);
  });

  it('rejects null, undefined, and non-objects', () => {
    expect(isKoemieruMessage(null)).toBe(false);
    expect(isKoemieruMessage(undefined)).toBe(false);
    expect(isKoemieruMessage('STOP_CAPTURE')).toBe(false);
    expect(isKoemieruMessage(42)).toBe(false);
  });

  it('rejects an object without a type field', () => {
    expect(isKoemieruMessage({ foo: 'bar' })).toBe(false);
  });

  it('rejects an object whose type field is not a string', () => {
    expect(isKoemieruMessage({ type: 123 })).toBe(false);
  });
});

describe('isMessageOfType', () => {
  it('narrows a matching message and exposes its variant-specific fields', () => {
    const message = { type: 'TRANSCRIPT_DELTA', itemId: 'item-1', delta: 'hel' } as const;

    if (isMessageOfType(message, 'TRANSCRIPT_DELTA')) {
      expect(message.itemId).toBe('item-1');
      expect(message.delta).toBe('hel');
    } else {
      throw new Error('expected message to match TRANSCRIPT_DELTA');
    }
  });

  it('returns false for a non-matching type', () => {
    const message = { type: 'STOP_CAPTURE' } as const;

    expect(isMessageOfType(message, 'START_CAPTURE')).toBe(false);
  });
});
