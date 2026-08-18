import { randomUUID } from "node:crypto";

const CAPABILITY_TTL_MS = 10 * 60_000;

export class CredentialCapabilities {
  private readonly values = new Map<string, { credentialRef: string; expiresAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  issue(credentialRef: string): string {
    this.prune();
    const capability = this.createId();
    this.values.set(capability, { credentialRef, expiresAt: this.now() + CAPABILITY_TTL_MS });
    return capability;
  }

  resolve(capability: string): string | undefined {
    const value = this.values.get(capability);
    if (!value || value.expiresAt <= this.now()) {
      this.values.delete(capability);
      return undefined;
    }
    return value.credentialRef;
  }

  private prune(): void {
    const now = this.now();
    for (const [capability, value] of this.values) {
      if (value.expiresAt <= now) this.values.delete(capability);
    }
  }
}
