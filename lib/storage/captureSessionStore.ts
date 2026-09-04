import { browser } from 'wxt/browser';

// Which tab is currently being captured, kept where a service-worker restart
// can't lose it.
//
// The background service worker is idle-killed after ~30s, but the offscreen
// document goes on capturing — it has its own lifetime and doesn't keep the
// worker alive. Broadcasts from it reset the idle timer, so during steady
// transcription the worker survives, but a pause with no transcription
// events (a Q&A silence, a break) is enough to let it die. Holding this in a
// module variable meant chrome.tabs.onRemoved compared against `undefined`
// after such a restart and never fired TAB_GONE for the tab actually being
// captured.
//
// `storage.session` rather than `local`: this is per-browser-session state
// that should not outlive the browser, and it keeps a tab id out of the same
// area as the API key (lib/storage/apiKeyStore.ts).
const STORAGE_KEY = 'capturedTabId';

export async function getCapturedTabId(): Promise<number | undefined> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return typeof value === 'number' ? value : undefined;
}

export async function setCapturedTabId(tabId: number): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEY]: tabId });
}

export async function clearCapturedTabId(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEY);
}
