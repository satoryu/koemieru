import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Koemieru',
    description:
      'Turns audio playing in a browser tab into a real-time transcript in the side panel.',
    // Empty action is required for openPanelOnActionClick to make the
    // toolbar icon open the side panel (see entrypoints/background.ts).
    action: {},
    // storage: persists the user's OpenAI API key locally (lib/storage/apiKeyStore.ts).
    // tabCapture: mints a stream ID for the active tab's audio (entrypoints/sidepanel).
    // offscreen: hosts the capture/streaming pipeline outside the service worker (entrypoints/offscreen).
    permissions: ['storage', 'tabCapture', 'offscreen'],
  },
});
