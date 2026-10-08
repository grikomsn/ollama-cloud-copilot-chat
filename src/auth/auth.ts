import { createHash, randomUUID } from "node:crypto";

const FORGOTTEN_ENTRIES_KEY = "ollamaCloudCopilot.forgottenEntries.v1";
const mutations = new WeakMap<NativeEntryState, Promise<void>>();

export interface NativeEntryState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface NativeEntryBinding {
  readonly entryId: string;
  readonly credentialRef: string;
  readonly generation: string;
}

export function credentialReference(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16);
}

export function nativeEntryId(configuration: Readonly<Record<string, unknown>>): string {
  const value = configuration.entryId;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error("Set a unique entryId in Manage Language Models: 1-64 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  return value;
}

/** Secrets are supplied by VS Code; only forgotten aliases are persisted. */
export class NativeEntries {
  private readonly entries = new Map<string, string>();
  private readonly keys = new Map<string, string>();
  private readonly generations = new Map<string, string>();
  private readonly forgotten: Set<string>;

  constructor(private readonly state?: NativeEntryState) {
    this.forgotten = forgottenAliases(state);
  }

  register(configuration: Readonly<Record<string, unknown>>): NativeEntryBinding {
    const entryId = nativeEntryId(configuration);
    if (this.isForgotten(entryId)) throw new Error("This native entry is forgotten. Run Ollama Cloud: Restore Native Entry before provisioning it.");
    const apiKey = typeof configuration.apiKey === "string" ? configuration.apiKey.trim() : "";
    if (!apiKey) throw new Error("Set the API key for this entry in Manage Language Models");
    const previous = this.entries.get(entryId);
    const credentialRef = credentialReference(apiKey);
    if (previous !== credentialRef || !this.generations.has(entryId)) this.generations.set(entryId, randomUUID());
    this.entries.set(entryId, credentialRef);
    this.keys.set(credentialRef, apiKey);
    if (previous && previous !== credentialRef) this.prune(previous);
    return { entryId, credentialRef, generation: this.generations.get(entryId)! };
  }

  list(): NativeEntryBinding[] {
    return [...this.entries].map(([entryId, credentialRef]) => ({ entryId, credentialRef, generation: this.generations.get(entryId)! }));
  }

  forgottenEntries(): string[] { return [...this.forgotten].sort(); }

  isForgotten(entryId: string): boolean { return this.forgotten.has(entryId); }

  matches(entryId: string, credentialRef: string, generation: string): boolean {
    return !this.isForgotten(entryId) && this.entries.get(entryId) === credentialRef && this.generations.get(entryId) === generation;
  }

  keyForCredential(credentialRef: string): string | undefined { return this.keys.get(credentialRef); }

  keyForEntry(entryId: string): string | undefined {
    const ref = this.entries.get(nativeEntryId({ entryId }));
    return ref ? this.keys.get(ref) : undefined;
  }

  async forget(entryId: string): Promise<void> {
    entryId = nativeEntryId({ entryId });
    this.forgotten.add(entryId);
    this.generations.set(entryId, randomUUID());
    const ref = this.entries.get(entryId);
    this.entries.delete(entryId);
    if (ref) this.prune(ref);
    try { await this.persist(entryId, true); } catch (error) {
      throw new Error("The entry is disabled in this window, but its block could not be saved. Retry Forget Native Entry before restarting.", { cause: error });
    }
  }

  async restore(entryId: string): Promise<void> {
    entryId = nativeEntryId({ entryId });
    if (!this.isForgotten(entryId)) return;
    const generation = randomUUID();
    this.generations.set(entryId, generation);
    await this.persist(entryId, false);
    // A later forget must win while the restore's write is pending.
    if (this.generations.get(entryId) === generation) this.forgotten.delete(entryId);
  }

  private async persist(entryId: string, forget: boolean): Promise<void> {
    const state = this.state;
    if (!state) return;
    const current = (mutations.get(state) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const aliases = forgottenAliases(state);
      if (forget) aliases.add(entryId);
      else aliases.delete(entryId);
      await state.update(FORGOTTEN_ENTRIES_KEY, [...aliases].sort());
    });
    mutations.set(state, current);
    try { await current; } finally { if (mutations.get(state) === current) mutations.delete(state); }
  }

  private prune(credentialRef: string): void {
    if (![...this.entries.values()].includes(credentialRef)) this.keys.delete(credentialRef);
  }
}

function forgottenAliases(state: NativeEntryState | undefined): Set<string> {
  const raw = state?.get<unknown>(FORGOTTEN_ENTRIES_KEY);
  return new Set(Array.isArray(raw) ? raw.filter((value): value is string =>
    typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) : []);
}
