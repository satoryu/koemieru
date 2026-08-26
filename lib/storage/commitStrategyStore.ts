import { browser } from 'wxt/browser';
import type { CommitStrategyType } from '@/lib/messaging/protocol';

// Persists the user's choice between the two lib/audio/commitStrategy.ts
// strategies, so it survives a side panel close/reopen and doesn't need to
// be re-selected before every capture.
const STORAGE_KEY = 'commitStrategy';
const DEFAULT_STRATEGY: CommitStrategyType = 'FIXED_INTERVAL';

function isCommitStrategyType(value: unknown): value is CommitStrategyType {
  return value === 'FIXED_INTERVAL' || value === 'VAD';
}

export async function getCommitStrategy(): Promise<CommitStrategyType> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return isCommitStrategyType(value) ? value : DEFAULT_STRATEGY;
}

export async function setCommitStrategy(strategy: CommitStrategyType): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: strategy });
}
