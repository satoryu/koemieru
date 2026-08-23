// Message types shared by all three extension contexts (side panel,
// background, offscreen document). Everything is routed through the
// background service worker, which is the single source of truth for
// capture session state — the side panel and the offscreen document never
// message each other directly.
//
// Direction key:
//   sidepanel -> background            (ENSURE_OFFSCREEN_READY, START_CAPTURE, STOP_CAPTURE)
//   background -> offscreen            (forwarded START_CAPTURE / STOP_CAPTURE)
//   offscreen -> background -> sidepanel (everything else, relayed verbatim)
//   background -> sidepanel            (TAB_GONE, originating from chrome.tabs.onRemoved)

export type CaptureFailureReason = 'PERMISSION_DENIED' | 'STREAM_ID_EXPIRED' | 'UNKNOWN';

export type KoemieruMessage =
  | { type: 'ENSURE_OFFSCREEN_READY' }
  | { type: 'START_CAPTURE'; streamId: string; tabId: number; apiKey: string }
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
