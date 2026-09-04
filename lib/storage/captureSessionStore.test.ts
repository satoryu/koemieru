import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearCapturedTabId, getCapturedTabId, setCapturedTabId } from './captureSessionStore';

describe('captureSessionStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns undefined when no capture is recorded', async () => {
    await expect(getCapturedTabId()).resolves.toBeUndefined();
  });

  it('round-trips the captured tab id', async () => {
    await setCapturedTabId(42);

    await expect(getCapturedTabId()).resolves.toBe(42);
  });

  it('overwrites a previously recorded tab id', async () => {
    await setCapturedTabId(42);
    await setCapturedTabId(7);

    await expect(getCapturedTabId()).resolves.toBe(7);
  });

  it('clears the recorded tab id', async () => {
    await setCapturedTabId(42);

    await clearCapturedTabId();

    await expect(getCapturedTabId()).resolves.toBeUndefined();
  });

  it('ignores a stored value that is not a number', async () => {
    // Defensive: storage is shared and survives extension updates, so a
    // value written by an older build shouldn't be handed back as a tab id.
    await fakeBrowser.storage.session.set({ capturedTabId: 'not-a-tab-id' });

    await expect(getCapturedTabId()).resolves.toBeUndefined();
  });

  it('keeps the tab id out of storage.local, which is where the API key lives', async () => {
    await setCapturedTabId(42);

    await expect(fakeBrowser.storage.local.get('capturedTabId')).resolves.toEqual({});
  });
});
