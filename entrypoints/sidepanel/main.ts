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
    <span id="api-key-saved" class="saved-indicator" hidden>Saved</span>
  </div>
  <p class="hint">
    Enter your API key and click outside the field (or press Tab/Enter) to
    save it — you'll see "Saved" appear. Then click the Koemieru icon in the
    toolbar on the tab you want to transcribe to start. (Chrome only grants
    tab-capture access from that click itself — a button in this panel can't
    trigger it.)
  </p>
  <div class="controls">
    <button id="stop" type="button" disabled>Stop</button>
  </div>
  <div id="status" class="status">Idle</div>
  <div id="transcript" class="transcript"></div>
`;

const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const apiKeySavedIndicator = document.querySelector<HTMLSpanElement>('#api-key-saved')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;

getApiKey().then((savedKey) => {
  if (savedKey) apiKeyInput.value = savedKey;
});

let savedIndicatorTimeout: ReturnType<typeof setTimeout> | undefined;

apiKeyInput.addEventListener('change', () => {
  void setApiKey(apiKeyInput.value).then(() => {
    apiKeySavedIndicator.hidden = false;
    clearTimeout(savedIndicatorTimeout);
    savedIndicatorTimeout = setTimeout(() => {
      apiKeySavedIndicator.hidden = true;
    }, 1500);
  });
});

type UiState = 'idle' | 'active';

function setUiState(state: UiState): void {
  stopButton.disabled = state === 'idle';
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

stopButton.addEventListener('click', () => {
  void handleStop();
});

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
      setStatus('Capturing tab audio… connecting to OpenAI…');
      break;

    case 'WS_OPEN':
      setStatus('Capturing tab audio… transcribing…');
      break;

    case 'WS_CLOSED':
      setUiState('idle');
      setStatus(
        `Connection to OpenAI closed${message.reason ? `: ${message.reason}` : ''}. Click the icon to start again.`,
      );
      break;

    case 'CAPTURE_FAILED':
      setUiState('idle');
      setStatus(describeCaptureFailure(message.reason, message.detail));
      break;

    case 'CAPTURE_STOPPED':
      setUiState('idle');
      setStatus('Idle');
      break;

    case 'TAB_GONE':
      setUiState('idle');
      setStatus('The captured tab was closed.');
      break;

    // TRANSCRIPT_DELTA/TRANSCRIPT_FINAL rendering is added once
    // lib/transcript/transcriptStore.ts exists (see docs/1-koemieru-mvp/tasks.md).
    default:
      break;
  }
});

function describeCaptureFailure(reason: CaptureFailureReason, detail?: string): string {
  switch (reason) {
    case 'PERMISSION_DENIED':
      return 'Tab audio capture permission was denied.';
    case 'STREAM_ID_EXPIRED':
      return 'Capture could not start (the tab may have changed). Click the icon again.';
    default:
      return detail ? `Capture failed: ${detail}` : 'Capture failed. See console for details.';
  }
}

// Transcript rendering (TRANSCRIPT_DELTA/TRANSCRIPT_FINAL) is added once
// lib/transcript/transcriptStore.ts exists (see docs/1-koemieru-mvp/tasks.md).
