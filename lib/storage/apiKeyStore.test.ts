import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearApiKey, getApiKey, setApiKey } from './apiKeyStore';

describe('apiKeyStore', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns undefined when no key has been saved', async () => {
    await expect(getApiKey()).resolves.toBeUndefined();
  });

  it('returns the key after it has been saved', async () => {
    await setApiKey('sk-test-123');

    await expect(getApiKey()).resolves.toBe('sk-test-123');
  });

  it('overwrites a previously saved key', async () => {
    await setApiKey('sk-old');
    await setApiKey('sk-new');

    await expect(getApiKey()).resolves.toBe('sk-new');
  });

  it('returns undefined after the key is cleared', async () => {
    await setApiKey('sk-test-123');

    await clearApiKey();

    await expect(getApiKey()).resolves.toBeUndefined();
  });

  it('stores the key in storage.local, not storage.sync', async () => {
    await setApiKey('sk-test-123');

    const local = await fakeBrowser.storage.local.get('openaiApiKey');
    const sync = await fakeBrowser.storage.sync.get('openaiApiKey');

    expect(local.openaiApiKey).toBe('sk-test-123');
    expect(sync.openaiApiKey).toBeUndefined();
  });
});
