import type { CatalogCache } from "./models/catalog";

const JOURNAL_KEY = "ollamaCloudCopilot.observedEntries.v1";
export interface EntryObservation { modelCount: number; updatedAt: number }
const mutations = new WeakMap<CatalogCache, Promise<void>>();

export function observedEntries(state: CatalogCache): Readonly<Record<string, EntryObservation>> {
  return state.get<Readonly<Record<string, EntryObservation>>>(JOURNAL_KEY) ?? {};
}

/** Aliases and model counts describe observation history, never live credential availability. */
export async function observeEntry(state: CatalogCache, entryId: string, modelCount: number | undefined): Promise<void> {
  const current = (mutations.get(state) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const entries = { ...observedEntries(state) };
    if (modelCount === undefined) delete entries[entryId];
    else entries[entryId] = { modelCount, updatedAt: Date.now() };
    await state.update(JOURNAL_KEY, entries);
  });
  mutations.set(state, current);
  try { await current; } finally { if (mutations.get(state) === current) mutations.delete(state); }
}
