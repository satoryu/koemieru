import { browser } from 'wxt/browser';
import { isKoemieruMessage } from '@/lib/messaging/protocol';

const OFFSCREEN_URL = '/offscreen.html';
const OFFSCREEN_JUSTIFICATION =
  'Captures and streams tab audio to OpenAI for real-time transcription.';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel instead of a popup.
  // (Requires `manifest.action: {}` in wxt.config.ts and no popup entrypoint.)
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior', error));

  // The background service worker doesn't perform the capture itself (no
  // DOM/Web Audio access, and it's idle-killed after ~30s) — it only owns
  // the offscreen document's lifecycle and tracks which tab is being
  // captured, by passively observing the same broadcasts the side panel
  // reacts to.
  let capturedTabId: number | undefined;

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

      case 'START_CAPTURE':
        capturedTabId = message.tabId;
        return undefined;

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
    browser.runtime.sendMessage({ type: 'TAB_GONE', tabId }).catch(() => undefined);
    browser.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => undefined);
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
