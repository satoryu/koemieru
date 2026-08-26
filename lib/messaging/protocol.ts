// Message types shared by all three extension contexts (side panel,
// background, offscreen document). Everything is sent via
// browser.runtime.sendMessage broadcasts; each context's listener acts on
// the types it owns and passively observes others it needs for bookkeeping
// (a context never receives its own broadcast back).
//
// Direction key:
//   background -> offscreen             (START_CAPTURE, STOP_CAPTURE, ENSURE_OFFSCREEN_READY as a readiness ping)
//   background -> sidepanel             (CAPTURE_FAILED when no API key is saved, TAB_GONE)
//   offscreen -> background, sidepanel  (CAPTURE_STARTED/FAILED, WS_*, TRANSCRIPT_*, CAPTURE_STOPPED — background
//                                        observes these passively for its own session bookkeeping)
//   sidepanel -> offscreen, background  (STOP_CAPTURE, from the panel's Stop button)
//
// START_CAPTURE is minted and sent by background.ts's `action.onClicked`
// handler, NOT by a button inside the side panel: Chrome only grants
// chrome.tabCapture/activeTab access from a qualifying user gesture (icon
// click, context menu, keyboard shortcut, omnibox), and deliberately does
// NOT extend that grant to clicks on elements inside an already-open side
// panel (see entrypoints/background.ts for the full explanation and a link
// to the relevant Chromium bug).

export type CaptureFailureReason = 'PERMISSION_DENIED' | 'STREAM_ID_EXPIRED' | 'UNKNOWN';

// Which lib/audio/commitStrategy.ts strategy the offscreen document should
// use to decide when to send input_audio_buffer.commit — user-selectable
// in the side panel (lib/storage/commitStrategyStore.ts) so the same audio
// source can be compared under both. See commitStrategy.ts for the
// trade-offs between them.
export type CommitStrategyType = 'FIXED_INTERVAL' | 'VAD';

export type KoemieruMessage =
  | { type: 'ENSURE_OFFSCREEN_READY' }
  | {
      type: 'START_CAPTURE';
      streamId: string;
      tabId: number;
      apiKey: string;
      commitStrategy: CommitStrategyType;
    }
  | { type: 'CAPTURE_STARTED' }
  | { type: 'CAPTURE_FAILED'; reason: CaptureFailureReason; detail?: string }
  | { type: 'WS_CONNECTING' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_CLOSED'; code?: number; reason?: string }
  | { type: 'WS_ERROR'; code?: number; reason?: string }
  | { type: 'TRANSCRIPT_DELTA'; itemId: string; delta: string }
  | { type: 'TRANSCRIPT_FINAL'; itemId: string; transcript: string }
  | { type: 'STOP_CAPTURE' }
  | { type: 'CAPTURE_STOPPED' }
  | { type: 'TAB_GONE'; tabId: number };

export type KoemieruMessageType = KoemieruMessage['type'];

/** Narrows an unknown value (e.g. from a runtime.onMessage listener) to a KoemieruMessage. */
export function isKoemieruMessage(value: unknown): value is KoemieruMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}

/** Narrows a KoemieruMessage to a specific variant by its `type` field. */
export function isMessageOfType<T extends KoemieruMessageType>(
  message: KoemieruMessage,
  type: T,
): message is Extract<KoemieruMessage, { type: T }> {
  return message.type === type;
}
