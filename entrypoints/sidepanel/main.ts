import './style.css';
import { browser } from 'wxt/browser';
import { getApiKey, setApiKey } from '@/lib/storage/apiKeyStore';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type { CaptureFailureReason } from '@/lib/messaging/protocol';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <h1>Koemieru</h1>
  <div class="api-key-row">
    <input id="api-key" type="password" placeholder="OpenAI API key" autocomplete="off" />
  </div>
  <div class="controls">
    <button id="start" type="button">Start</button>
    <button id="stop" type="button" disabled>Stop</button>
  </div>
  <div id="status" class="status">Idle</div>
  <div id="transcript" class="transcript"></div>
`;

const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;

getApiKey().then((savedKey) => {
  if (savedKey) apiKeyInput.value = savedKey;
});

apiKeyInput.addEventListener('change', () => {
  void setApiKey(apiKeyInput.value);
});

type UiState = 'idle' | 'connecting' | 'active';

function setUiState(state: UiState): void {
  startButton.disabled = state !== 'idle';
  stopButton.disabled = state === 'idle';
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

startButton.addEventListener('click', () => {
  void handleStart();
});

stopButton.addEventListener('click', () => {
  void handleStop();
});

async function handleStart(): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus('Enter your OpenAI API key first.');
    return;
  }

  setUiState('connecting');
  setStatus('Preparing capture…');

  try {
    // Must stay in this same click handler, with no unrelated async work
    // between minting the stream ID and sending it off, since the stream ID
    // is single-use and expires within seconds (see docs/1-koemieru-mvp/design.md).
    await browser.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN_READY' });

    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      throw new Error('No active tab to capture.');
    }

    const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: activeTab.id });

    await browser.runtime.sendMessage({
      type: 'START_CAPTURE',
      streamId,
      tabId: activeTab.id,
      apiKey,
    });
  } catch (error) {
    console.error('Failed to start capture', error);
    setStatus('Could not start capture. See console for details.');
    setUiState('idle');
  }
}

async function handleStop(): Promise<void> {
  setUiState('idle');
  setStatus('Stopping…');
  await browser.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => undefined);
}

browser.runtime.onMessage.addListener((message) => {
  if (!isKoemieruMessage(message)) return;

  switch (message.type) {
    case 'CAPTURE_STARTED':
      setUiState('active');
      setStatus('Capturing tab audio…');
      break;

    case 'CAPTURE_FAILED':
      setUiState('idle');
      setStatus(describeCaptureFailure(message.reason));
      break;

    case 'CAPTURE_STOPPED':
      setUiState('idle');
      setStatus('Idle');
      break;

    case 'TAB_GONE':
      setUiState('idle');
      setStatus('The captured tab was closed.');
      break;

    default:
      break;
  }
});

function describeCaptureFailure(reason: CaptureFailureReason): string {
  switch (reason) {
    case 'PERMISSION_DENIED':
      return 'Tab audio capture permission was denied.';
    case 'STREAM_ID_EXPIRED':
      return 'Capture could not start (the tab may have changed). Try again.';
    default:
      return 'Capture failed. See console for details.';
  }
}

// Transcript rendering (TRANSCRIPT_DELTA/TRANSCRIPT_FINAL) is added once
// lib/transcript/transcriptStore.ts exists (see docs/1-koemieru-mvp/tasks.md).
