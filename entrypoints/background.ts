import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type { KoemieruMessage } from '@/lib/messaging/protocol';
import { getApiKey } from '@/lib/storage/apiKeyStore';

const OFFSCREEN_URL = '/offscreen.html';
const OFFSCREEN_JUSTIFICATION =
  'Captures and streams tab audio to OpenAI for real-time transcription.';

export default defineBackground(() => {
  // The background service worker doesn't perform the capture itself (no
  // DOM/Web Audio access, and it's idle-killed after ~30s) — it only owns
  // the offscreen document's lifecycle and tracks which tab is being
  // captured.
  let capturedTabId: number | undefined;

  // IMPORTANT: capture must start from `action.onClicked`, not a button
  // inside the side panel. Chrome's `activeTab`/`tabCapture` grant requires
  // a qualifying user gesture (icon click, context-menu item, keyboard
  // shortcut, or omnibox selection) — Chrome deliberately does NOT extend
  // that grant to clicks on elements inside an already-open side panel,
  // since it's a persistent surface (see the Chromium team's own
  // explanation on crbug.com/40926394, filed Won't-Fix). So we do NOT use
  // `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` here —
  // that would suppress `onClicked` entirely. Instead, clicking the toolbar
  // icon both opens the panel for that tab and starts capturing it, in the
  // same gesture-bearing handler.
  browser.action.onClicked.addListener((tab) => {
    void handleActionClick(tab);
  });

  async function handleActionClick(tab: Browser.tabs.Tab): Promise<void> {
    console.log('[background] action.onClicked', { tabId: tab.id, url: tab.url });
    if (tab.id === undefined) return;
    const tabId = tab.id;

    await browser.sidePanel
      .open({ tabId })
      .catch((error) => console.error('Failed to open side panel', error));

    if (capturedTabId !== undefined) {
      // Already capturing (this tab or another) — just surface the panel,
      // don't start a second pipeline. Stop first via the panel's Stop
      // button to start a different tab.
      console.log('[background] already capturing tab', capturedTabId, '— not starting a new session');
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      console.log('[background] no API key saved — aborting start');
      await broadcast({
        type: 'CAPTURE_FAILED',
        reason: 'UNKNOWN',
        detail: 'Enter your OpenAI API key in the side panel first.',
      });
      return;
    }

    try {
      await ensureOffscreenReady();
      console.log('[background] offscreen document ready, minting stream id');
      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
      capturedTabId = tabId;
      console.log('[background] sending START_CAPTURE', { tabId });
      await broadcast({ type: 'START_CAPTURE', streamId, tabId, apiKey });
    } catch (error) {
      console.error('Failed to start capture', error);
      await broadcast({
        type: 'CAPTURE_FAILED',
        reason: 'UNKNOWN',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isKoemieruMessage(message)) return undefined;

    switch (message.type) {
      case 'ENSURE_OFFSCREEN_READY':
        ensureOffscreenReady().then(
          () => sendResponse({}),
          (error) => {
            console.error('Failed to prepare offscreen document', error);
            sendResponse(undefined);
          },
        );
        return true; // keep the message channel open for the async response

      case 'CAPTURE_FAILED':
      case 'CAPTURE_STOPPED':
        capturedTabId = undefined;
        closeOffscreenDocument();
        return undefined;

      default:
        return undefined;
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== capturedTabId) return;
    capturedTabId = undefined;
    broadcast({ type: 'TAB_GONE', tabId });
    broadcast({ type: 'STOP_CAPTURE' });
  });
});

async function ensureOffscreenReady(): Promise<void> {
  if (!(await hasOffscreenDocument())) {
    await browser.offscreen.createDocument({
      url: browser.runtime.getURL(OFFSCREEN_URL),
      reasons: ['USER_MEDIA'],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  }
  await pingOffscreenDocument();
}

async function hasOffscreenDocument(): Promise<boolean> {
  // hasDocument() is a recent addition (Chrome 150+ per its type
  // definition) — fall back to "assume absent" on older Chrome, where
  // createDocument()'s own "already exists" rejection is the fallback
  // signal (see the catch in the caller's caller).
  if (typeof browser.offscreen.hasDocument !== 'function') return false;
  try {
    return await browser.offscreen.hasDocument();
  } catch {
    return false;
  }
}

// createDocument() resolving only means the document started loading, not
// that its main.ts has registered a message listener yet — so ping it and
// retry a few times before giving up, rather than assuming it's ready.
async function pingOffscreenDocument(): Promise<void> {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await browser.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN_READY' });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

function closeOffscreenDocument(): void {
  browser.offscreen
    .closeDocument()
    .catch((error) => console.error('Failed to close offscreen document', error));
}

function broadcast(message: KoemieruMessage): Promise<unknown> {
  return browser.runtime.sendMessage(message).catch(() => undefined);
}
