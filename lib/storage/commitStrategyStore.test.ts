import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getCommitStrategy, setCommitStrategy } from './commitStrategyStore';

describe('commitStrategyStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to FIXED_INTERVAL when nothing has been saved', async () => {
    await expect(getCommitStrategy()).resolves.toBe('FIXED_INTERVAL');
  });

  it('returns the saved strategy', async () => {
    await setCommitStrategy('VAD');

    await expect(getCommitStrategy()).resolves.toBe('VAD');
  });

  it('overwrites a previously saved strategy', async () => {
    await setCommitStrategy('VAD');
    await setCommitStrategy('FIXED_INTERVAL');

    await expect(getCommitStrategy()).resolves.toBe('FIXED_INTERVAL');
  });

  it('falls back to FIXED_INTERVAL for an unrecognized stored value', async () => {
    await fakeBrowser.storage.local.set({ commitStrategy: 'NOT_A_REAL_STRATEGY' });

    await expect(getCommitStrategy()).resolves.toBe('FIXED_INTERVAL');
  });
});
