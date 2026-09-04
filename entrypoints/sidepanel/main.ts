import './style.css';
import { browser } from 'wxt/browser';
import { getApiKey, setApiKey } from '@/lib/storage/apiKeyStore';
import { getCommitStrategy, setCommitStrategy } from '@/lib/storage/commitStrategyStore';
import { isKoemieruMessage } from '@/lib/messaging/protocol';
import type {
  CaptureFailureReason,
  CaptureState,
  CommitStrategyType,
} from '@/lib/messaging/protocol';
import { createTranscriptStore, transcriptStateToText } from '@/lib/transcript/transcriptStore';

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
  <div class="commit-strategy-row">
    <label for="commit-strategy">Turn commit:</label>
    <select id="commit-strategy">
      <option value="FIXED_INTERVAL">Fixed interval (6s)</option>
      <option value="VAD">Simple VAD (pause detection)</option>
    </select>
  </div>
  <p class="hint">
    Controls when audio is sent for transcription. Fixed interval commits
    every 6s regardless of speech; Simple VAD waits for a pause instead, to
    avoid cutting mid-sentence. Takes effect on the next Start.
  </p>
  <div class="controls">
    <button id="stop" type="button" disabled>Stop</button>
    <button id="copy" type="button" disabled>Copy transcript</button>
    <span id="copy-done" class="saved-indicator" hidden>Copied</span>
  </div>
  <div id="status" class="status">Idle</div>
  <div id="transcript" class="transcript"></div>
`;

const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const apiKeySavedIndicator = document.querySelector<HTMLSpanElement>('#api-key-saved')!;
const commitStrategySelect = document.querySelector<HTMLSelectElement>('#commit-strategy')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!;
const copyDoneIndicator = document.querySelector<HTMLSpanElement>('#copy-done')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const transcriptEl = document.querySelector<HTMLDivElement>('#transcript')!;

const transcriptStore = createTranscriptStore();

getApiKey().then((savedKey) => {
  if (savedKey) apiKeyInput.value = savedKey;
});

getCommitStrategy().then((strategy) => {
  commitStrategySelect.value = strategy;
});

// This panel is a fresh document every time it's opened, so a capture
// started before it opened would otherwise leave Stop greyed out with no way
// to end the session from the UI — while transcript deltas kept arriving
// under an "Idle" label. Ask the offscreen document what's actually going on.
// The transcript from before this panel opened is genuinely gone (the store
// lives here, not in the offscreen document), so say so rather than implying
// the session just started.
void syncToRunningCapture();

async function syncToRunningCapture(): Promise<void> {
  const state = await browser.runtime
    .sendMessage({ type: 'GET_CAPTURE_STATE' })
    .catch(() => undefined) as CaptureState | undefined;
  if (!state?.isCapturing) return;

  setUiState('active');
  setStatus('Capturing tab audio… (transcript from before this panel opened is not shown)');
}

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

commitStrategySelect.addEventListener('change', () => {
  void setCommitStrategy(commitStrategySelect.value as CommitStrategyType);
});

type UiState = 'idle' | 'active';

function setUiState(state: UiState): void {
  stopButton.disabled = state === 'idle';
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 24;

function isScrolledToBottom(): boolean {
  return (
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight <=
    SCROLL_BOTTOM_THRESHOLD_PX
  );
}

/** Renders transcriptStore's current state without duplicating text, and
 * auto-follows new text unless the user has scrolled away from the bottom. */
function renderTranscript(): void {
  const state = transcriptStore.getState();
  const wasAtBottom = isScrolledToBottom();

  transcriptEl.replaceChildren();
  state.segments.forEach((segment, index) => {
    if (index > 0) transcriptEl.append(document.createTextNode('\n\n'));
    transcriptEl.append(document.createTextNode(segment));
  });
  if (state.inProgress) {
    if (state.segments.length > 0) transcriptEl.append(document.createTextNode('\n\n'));
    const partialEl = document.createElement('span');
    partialEl.className = 'partial';
    partialEl.textContent = state.inProgress.text;
    transcriptEl.append(partialEl);
  }

  if (wasAtBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;

  copyButton.disabled = state.segments.length === 0 && !state.inProgress;
}

stopButton.addEventListener('click', () => {
  void handleStop();
});

async function handleStop(): Promise<void> {
  setUiState('idle');
  setStatus('Stopping…');
  await browser.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => undefined);
}

let copyDoneTimeout: ReturnType<typeof setTimeout> | undefined;

copyButton.addEventListener('click', () => {
  void handleCopy();
});

async function handleCopy(): Promise<void> {
  const text = transcriptStateToText(transcriptStore.getState());
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    copyDoneIndicator.hidden = false;
    clearTimeout(copyDoneTimeout);
    copyDoneTimeout = setTimeout(() => {
      copyDoneIndicator.hidden = true;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy transcript', error);
    setStatus('Could not copy the transcript. See console for details.');
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (!isKoemieruMessage(message)) return;

  switch (message.type) {
    case 'CAPTURE_STARTED':
      transcriptStore.reset();
      renderTranscript();
      setUiState('active');
      setStatus('Capturing tab audio… connecting to OpenAI…');
      break;

    case 'TRANSCRIPT_DELTA':
      transcriptStore.applyDelta(message.itemId, message.delta);
      renderTranscript();
      break;

    case 'TRANSCRIPT_FINAL':
      transcriptStore.applyFinal(message.itemId, message.transcript);
      renderTranscript();
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
      // ALREADY_CAPTURING means the existing session is still running, so
      // Stop must stay available — it's the only way to end it.
      setUiState(message.reason === 'ALREADY_CAPTURING' ? 'active' : 'idle');
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
    case 'ALREADY_CAPTURING':
      return 'Already capturing. Stop the current session before starting another tab.';
    default:
      return detail ? `Capture failed: ${detail}` : 'Capture failed. See console for details.';
  }
}
