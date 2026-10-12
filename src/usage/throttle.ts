/** Minimum interval between automatic post-request usage refreshes per credential. */
export const USAGE_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

/**
 * Decides whether an automatic (post-request) usage refresh may run now.
 * Manual refreshes never consult this gate; a burst of chat requests must
 * not turn into one usage call per request, so automatic refreshes share a
 * per-credential cooldown.
 *
 * A missing or invalid last-refresh timestamp counts as "never refreshed"
 * and always refreshes. A future timestamp (clock skew) falls inside the
 * cooldown and skips — the conservative reading of "refreshed just now".
 */
export function shouldAutoRefreshUsage(
  now: number,
  lastRefreshAt: number | undefined,
  minIntervalMs: number = USAGE_REFRESH_MIN_INTERVAL_MS,
): boolean {
  if (lastRefreshAt === undefined || !Number.isFinite(lastRefreshAt) || lastRefreshAt < 0) return true;
  return now - lastRefreshAt >= minIntervalMs;
}
