import type { DeveloperActionRecord } from "./developerToolsTypes";

const ACTIONS_KEY = "platform.developerTools.actions.v1";
const SUCCESSFUL_RUNS_KEY = "platform.developerTools.successfulRunIds.v1";
const MAX_ACTIONS = 50;

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

export const loadDeveloperActions = (): DeveloperActionRecord[] =>
  readJson<DeveloperActionRecord[]>(ACTIONS_KEY, []).slice(0, MAX_ACTIONS);

export const saveDeveloperAction = (record: DeveloperActionRecord): DeveloperActionRecord[] => {
  const actions = [record, ...loadDeveloperActions().filter((item) => item.id !== record.id)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_ACTIONS);
  try {
    window.localStorage.setItem(ACTIONS_KEY, JSON.stringify(actions));
  } catch {
    // The current page state still retains the audit-shaped record when storage is unavailable.
  }
  return actions;
};

export const wasRunIdSuccessful = (runId: string): boolean =>
  readJson<string[]>(SUCCESSFUL_RUNS_KEY, []).includes(runId);

export const rememberSuccessfulRunId = (runId: string) => {
  const runIds = [...new Set([runId, ...readJson<string[]>(SUCCESSFUL_RUNS_KEY, [])])].slice(0, 100);
  try {
    window.localStorage.setItem(SUCCESSFUL_RUNS_KEY, JSON.stringify(runIds));
  } catch {
    // The backend remains idempotent; this is an additional client-side guard.
  }
};
