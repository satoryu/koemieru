# Koemieru

**Koemieru** is a browser extension that turns audio playing in a browser tab into real-time text.

The initial goal is simple: capture audio from a selected browser tab, transcribe it in real time, and display the transcript in the browser.

Over time, Koemieru may also use the transcript to provide contextual assistance such as explanations for unfamiliar terms, helping users stay focused on what they are listening to without switching tabs to look things up.

## Tech Stack

* TypeScript
* WXT
* Chrome Extension Manifest V3
* OpenAI Realtime API

## Development

Install dependencies:

```bash
pnpm install
```

Start the development environment:

```bash
pnpm dev
```

Build the extension:

```bash
pnpm build
```

## Project Direction

Koemieru starts as a real-time transcription tool, but transcription is intended to become the foundation for richer listening assistance.

A future version could identify terms that may need explanation and surface contextual information without interrupting the content being played.

The broader idea is simple:

> Keep listening without losing the context.

## License

This project is licensed under the MIT License.
