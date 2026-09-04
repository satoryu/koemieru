import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type { CaptureState, KoemieruMessage } from '@/lib/messaging/protocol';
import { getApiKey } from '@/lib/storage/apiKeyStore';
import {
  clearCapturedTabId,
  getCapturedTabId,
  setCapturedTabId,
} from '@/lib/storage/captureSessionStore';
import { getCommitStrategy } from '@/lib/storage/commitStrategyStore';

const OFFSCREEN_URL = '/offscreen.html';
const OFFSCREEN_JUSTIFICATION =
  'Captures and streams tab audio to OpenAI for real-time transcription.';

export default defineBackground(() => {
  // Chrome persists sidePanel.setPanelBehavior() across code updates and
  // service worker restarts — it's not reset just because the call is
  // removed from the code. An earlier version of this file called
  // setPanelBehavior({ openPanelOnActionClick: true }), which then silently
  // kept suppressing action.onClicked (see below) even after that call was
  // deleted. Explicitly set it back to false so a browser profile that ran
  // that earlier version doesn't get stuck with the old behavior.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error('Failed to reset side panel behavior', error));

  // The background service worker doesn't perform the capture itself (no
  // DOM/Web Audio access, and it's idle-killed after ~30s) — it only owns
  // the offscreen document's lifecycle and tracks which tab is being
  // captured.
  //
  // That ~30s matters: this worker dies during any pause with no
  // transcription events to wake it, while the offscreen document keeps
  // capturing. So neither "is a capture running" nor "which tab" may live in
  // a module variable here — the first is answered by the offscreen document
  // itself (GET_CAPTURE_STATE), the second by storage.session
  // (lib/storage/captureSessionStore.ts).

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

    if (await isOffscreenCapturing()) {
      // Already capturing (this tab or another) — just surface the panel,
      // don't start a second pipeline. Stop first via the panel's Stop
      // button to start a different tab.
      console.log('[background] already capturing — not starting a new session');
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
      const commitStrategy = await getCommitStrategy();
      await setCapturedTabId(tabId);
      console.log('[background] sending START_CAPTURE', { tabId, commitStrategy });
      await broadcast({ type: 'START_CAPTURE', streamId, tabId, apiKey, commitStrategy });
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
        // ALREADY_CAPTURING is the one failure that reports a *healthy*
        // session: the offscreen document refused a second START_CAPTURE.
        // Tearing it down here would destroy the very capture it was
        // protecting — abruptly, with the WebSocket never closed and the
        // last buffered audio never committed.
        if (message.reason === 'ALREADY_CAPTURING') return undefined;
        endSession();
        return undefined;

      case 'CAPTURE_STOPPED':
      case 'WS_CLOSED':
        // WS_CLOSED means the offscreen document already tore its own
        // resources down (see its onClose handler) after an unexpected
        // OpenAI connection drop — treat it as a session end here too.
        endSession();
        return undefined;

      default:
        return undefined;
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void handleTabRemoved(tabId);
  });

  async function handleTabRemoved(tabId: number): Promise<void> {
    if (tabId !== (await getCapturedTabId())) return;
    await clearCapturedTabId();
    await broadcast({ type: 'TAB_GONE', tabId });
    await broadcast({ type: 'STOP_CAPTURE' });
  }

  function endSession(): void {
    void clearCapturedTabId();
    closeOffscreenDocument();
  }
});

/** Whether a capture is actually running, according to the only context that
 * knows. No offscreen document means no capture, so this never creates one
 * just to ask. */
async function isOffscreenCapturing(): Promise<boolean> {
  if (!(await hasOffscreenDocument())) return false;
  try {
    const state = (await browser.runtime.sendMessage({
      type: 'GET_CAPTURE_STATE',
    })) as CaptureState | undefined;
    return state?.isCapturing === true;
  } catch (error) {
    // A document that exists but doesn't answer isn't capturing anything
    // usable — let the caller start fresh rather than blocking forever.
    console.warn('[background] offscreen document did not report its state', error);
    return false;
  }
}

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
