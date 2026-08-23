# CLAUDE.md

## Project Overview

Koemieru is a browser extension that turns audio playing in a browser tab into real-time text (see [README.md](README.md)). The initial goal is tab audio capture → real-time transcription → on-page display; later it may add contextual assistance (e.g. explaining unfamiliar terms) built on top of the transcript.

## Tech Stack

- TypeScript
- [WXT](https://wxt.dev/) (browser extension framework, uses Vite internally)
- Chrome Extension Manifest V3
- OpenAI Realtime API (real-time audio transcription)
- Package manager: pnpm (`pnpm install` / `pnpm dev` / `pnpm build`)

## Project Structure

Follows WXT's standard layout. Clean Architecture-style layering (domain/data/presentation) is not enforced.

- `entrypoints/` — extension entry points (`background.ts`, `content.ts`, `popup/`). WXT generates `manifest.json` from this directory's structure.
- `components/` — shared logic/UI parts used by the entry points.
- `assets/` — static assets processed at build time.
- `public/` — static files copied as-is (icons, etc.).

If `components/` grows too large as features are added, consider splitting into `lib/` or feature-based directories at that point. Don't preemptively restructure before it's needed.

## Workflow

0. Create a development environment to work on the issue.
1. Analyze the user's request in the issue and write down the requirements in the document `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/requirements.md`.
2. Design the architecture and write it down in `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/design.md`.
3. Plan the implementation tasks and create a checklist in `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/tasks.md`.
4. You must be approved by the user before starting the implementation.
5. Implement the tasks one by one, following TDD principles after approval.
6. After completing the implementation, create a pull request to merge the feature branch into the `main` branch.
7. Review the code and write a review feedback to the pull-request.

## Documents

### `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/requirements.md`

This document contains the requirements for the issue number `[ISSUE-NUMBER]`, including the following sections:

- Problem Statement
- Requirements(Functional and Non-Functional)
- Constraints
- Acceptance Criteria
- User Stories

### `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/design.md`

This document contains the design for the issue number `[ISSUE-NUMBER]`, including the following sections:

- Architecture Overview
- Component Design
- Data Flow
- Domain Models

The diagrams should be created using [Mermaid](https://mermaid-js.github.io/mermaid/#/) syntax.

### `docs/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]/tasks.md`

This document contains the implementation tasks for the issue number `[ISSUE-NUMBER]`, including a checklist of tasks to be completed.

You must complete each task in order and check them off as you complete them.

## Implementation

You must follow TDD (Test-Driven Development) principles when implementing the tasks.
This means you must write todos to complete the task first, then write a test that fails, and finally implement the code to make the test pass. Then refactor the code if necessary.

## Testing

[Vitest](https://vitest.dev/) is the chosen test framework (not yet set up as of this writing — set it up as part of the first task that adds tests: add `vitest` via `pnpm add -D vitest`, add a `vitest.config.ts`, and add `test` / `test:watch` scripts to `package.json`).

Once set up, tests are expected to run via:

```bash
pnpm test          # run the whole suite once
pnpm test:watch    # watch mode

pnpm compile        # type-check (tsc --noEmit)
```

Code that depends on extension-specific APIs (e.g. `chrome.tabCapture`) should be designed so it can be unit-tested behind fakes/mocks, leaving manual verification in a real browser (see "In-Browser Testing" below) to cover what unit tests can't.

## Branching Strategy

GitHub flow is used as the branching strategy.

- `main` branch: This is the production-ready branch. Only code that has been tested and approved should be merged into this branch.
- `feature/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]` branches: These branches are used for developing new features. They should be created from the `main` branch and merged back into `main` when the feature is complete.

## Code Reviews

After completing the implementation of a feature, you must create a pull request to merge the `feature/[ISSUE-NUMBER]-[SHORT-DESCRIPTION]` branch into the `main` branch.
Then you must review the code by yourself and write a review feedback to the pull-request, ensure that it meets the requirements and passes all tests before merging.

In review phase, you must focus on the following aspects:

- Correctness
- Readability
- Performance
- Security
- Maintainability

When issues are found during code review, do not dismiss them solely because they fall below a scoring threshold. Any issue flagged with high confidence (e.g. resource leaks, unclear test intent, code duplication, insufficient assertions) must be evaluated and fixed before merging.

## In-Browser Testing

When the Test Plan includes manual verification items (popup UI, tab audio capture, transcript display, etc.), you must perform the verification yourself in Chrome. Do not leave it to the user unless the browser environment is genuinely unavailable.

1. Run `pnpm dev` and load the unpacked extension from `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked" (or use the artifact produced by `pnpm build`).
2. Launch the extension on a target tab and manually verify each Acceptance Criterion.
3. **Always verify graceful handling when tab-audio-capture permission is denied or the target tab no longer exists** (`chrome.tabCapture` / `getDisplayMedia`-family APIs have many failure paths: permission denial, tab switching, tab closing, etc.).
4. Verify behavior when the connection to the OpenAI Realtime API drops (network failure, API error, rate limiting).
5. Check off the verified items in the PR Test Plan.

## Merging

Do not merge a PR if there are unchecked items in its Test Plan. For items that cannot be verified by automated tests (e.g. in-browser verification), perform the verification yourself first. Only ask the user for approval if the environment is genuinely unavailable.

## Definition of Done

Merging is not the end of the work. An Issue/PR is done only when all of the following hold:

1. CI is green (CI is not yet set up; once it is, add the wait/gate procedure — e.g. via `gh pr checks` — to this section).
2. `pnpm build` produces the extension package successfully.
3. The change has been verified running in Chrome (see "In-Browser Testing" above).
4. Record the verification results on the PR / Issue before closing it.

Once a publishing flow (e.g. Chrome Web Store) is established, add the post-publish verification steps to this section.

## Verification Principles

- **Never implement from memory**: verify specs, commands, and constraints of external services (WXT, Chrome Extension APIs, OpenAI Realtime API) against official docs before implementing. These APIs are prone to breaking changes between versions, so check the official docs before implementing.
- **Grep the blast radius before changing code**: find callers, tests, and fake implementations first, then design the change.

## Known Pitfalls (project-specific)

- **Handling the OpenAI API key**: never write the API key to the repository or to logs. Embedding the key directly in the extension makes it extractable from a user's machine, so decide the key-delivery approach (user-supplied input, a backend proxy, etc.) at design time.
- **`chrome.tabCapture` can only be called from a context that originates from a user gesture** (e.g. clicking the extension icon). Calling it automatically from the background will fail — keep this in mind when designing the UI flow.
- This section exists to record pitfalls hit while implementing. It's short because the project is still early-stage — add to it as problems come up.
