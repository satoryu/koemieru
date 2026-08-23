import { browser } from 'wxt/browser';

// Deliberately `storage.local`, not `storage.sync`: the API key must stay on
// this device and never ride Chrome account sync. See CLAUDE.md's "Known
// Pitfalls" about deciding the key-delivery approach deliberately.
const STORAGE_KEY = 'openaiApiKey';

export async function getApiKey(): Promise<string | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return typeof value === 'string' ? value : undefined;
}

export async function setApiKey(apiKey: string): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: apiKey });
}

export async function clearApiKey(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}
