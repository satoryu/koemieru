import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Koemieru',
    description:
      'Turns audio playing in a browser tab into a real-time transcript in the side panel.',
    // Empty action (no default_popup) is required for action.onClicked to
    // fire on toolbar icon clicks, which both opens the side panel and
    // starts capture in the same gesture (see entrypoints/background.ts —
    // Chrome does not grant tabCapture from a click inside the panel).
    action: {},
    // storage: persists the user's OpenAI API key locally (lib/storage/apiKeyStore.ts).
    // tabCapture: mints a stream ID for the active tab's audio (entrypoints/sidepanel).
    // offscreen: hosts the capture/streaming pipeline outside the service worker (entrypoints/offscreen).
    // activeTab: tabCapture's targetTabId must be a tab the extension was
    // just invoked on (e.g. via the toolbar icon click that opens the side
    // panel) — without this, getMediaStreamId() rejects with "Extension has
    // not been invoked for the current page".
    permissions: ['storage', 'tabCapture', 'offscreen', 'activeTab'],
    // Outbound WebSocket connection to OpenAI's Realtime API
    // (entrypoints/offscreen/main.ts, lib/openai/realtimeSession.ts).
    host_permissions: ['https://api.openai.com/*'],
  },
});
