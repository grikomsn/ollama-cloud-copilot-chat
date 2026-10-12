#!/usr/bin/env node
// Model-metadata resync helper for Ollama Cloud.
// Probes the live /api/tags catalog with /api/show hydration, diffs both
// against the bundled SNAPSHOT compiled from src/models, applies mechanical
// refreshes (context windows, capability sets, and models.dev-backed entries
// for newly hosted ids), and can open the pull request. Retirement pruning,
// pricing capture, and thinking profiles require manual review and are only
// reported.
//
// Usage:
//   npm run refresh-models                              # report only
//   node scripts/refresh-models.mjs --apply             # rewrite bundled snapshot
//   node scripts/refresh-models.mjs --pr                # --apply + branch/push/PR
//
// The Ollama API key is read from the gitignored .env file. Keys are never
// printed, logged, or committed.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_FILE = path.join(ROOT, "src/models/catalog.ts");
const SNAPSHOT_START = "const SNAPSHOT: readonly SnapshotModel[] = [\n";
const SNAPSHOT_END = "];\n";
const CHANGESET_SUMMARY = "Resync bundled Ollama Cloud snapshot metadata with the live catalog.";
const MODELS_DEV_URL = "https://models.dev/api.json";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") || argv.includes("--pr") || argv.includes("--ci");
const CREATE_PR = argv.includes("--pr");
const reportFileIdx = argv.indexOf("--report-file");
const reportPath = reportFileIdx >= 0 ? argv[reportFileIdx + 1] : undefined;
const require_ = createRequire(import.meta.url);

const report = [];
function log(line = "") {
  report.push(line);
  console.log(line);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

function envKey(name) {
  const fromEnvironment = process.env[name]?.trim();
  if (fromEnvironment) return fromEnvironment;
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return undefined;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim();
  return value || undefined;
}

function requireBundled() {
  const resolved = path.join(ROOT, "out", "models/catalog.js");
  if (!existsSync(resolved) || srcNewerThan(resolved)) {
    const compiled = spawnSync("npm", ["run", "compile"], { cwd: ROOT, encoding: "utf8" });
    if (compiled.status) {
      console.error(compiled.stderr);
      process.exit(compiled.status ?? 1);
    }
  }
  return {
    catalog: require_(resolved),
    metadata: require_(path.join(ROOT, "out", "models/metadata.js")),
    limitProbe: require_(path.join(ROOT, "out", "models/limit-probe.js")),
    pricing: require_(path.join(ROOT, "out", "models/pricing.js")),
    pricingDrift: require_(path.join(ROOT, "out", "models/pricing-drift.js")),
  };
}

/** True when any TypeScript source is newer than the compiled target. */
function srcNewerThan(target) {
  const compiled = statSync(target).mtimeMs;
  const stack = [path.join(ROOT, "src")];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(?:ts|mts)$/.test(entry.name) && statSync(full).mtimeMs > compiled) return true;
    }
  }
  return false;
}

const LINE_PATTERN = /{ id: "([^"]+)", contextLength: (\d+), maxOutputTokens: (\d+), capabilities: "([^"]*)" }/;

// Max-output-token probing (plan R2): /api/show does not publish output
// ceilings, so each snapshot model still hosted upstream is probed against
// the OpenAI-compatible chat endpoint with ascending max_tokens tiers and a
// stop sequence; a rejection reports the exact limit in its message. The
// tier walk decision lives in src/models/limit-probe.ts (compiled to out/)
// so it is unit-testable; indeterminate probes keep the existing value.
const PROBE_TIMEOUT_MS = 60_000;
const PROBE_WORKERS = 4;
const CHAT_COMPLETIONS_URL = "https://ollama.com/v1/chat/completions";

/** Probes one model's max output tokens; returns a status plus the best verified ceiling. */
async function probeMaxTokens(id, apiKey, bundled) {
  const { PROBE_TIERS, decideProbeStep } = bundled.limitProbe;
  for (const tier of PROBE_TIERS) {
    let accepted = false;
    let errorMessage;
    try {
      const response = await fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: id,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: tier,
          stop: ["OK"],
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        accepted = true;
      } else {
        errorMessage = await response.text();
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const step = decideProbeStep(tier, accepted, errorMessage);
    if (step.action === "ascend") continue;
    if (step.action === "accept") return { status: "probed", limit: step.limit };
    if (step.action === "unproven") return { status: "unproven", limit: step.limit };
    return { status: "indeterminate" };
  }
  return { status: "indeterminate" };
}

/** Runs the probe phase over snapshot entries still hosted upstream, `workers` at a time. */
async function probeSnapshotLimits(snapshot, hostedIds, apiKey, bundled) {
  const targets = snapshot.filter((entry) => hostedIds.includes(entry.id));
  const probes = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROBE_WORKERS, targets.length) }, async () => {
    while (next < targets.length) {
      const entry = targets[next++];
      probes.set(entry.id, await probeMaxTokens(entry.id, apiKey, bundled));
    }
  }));
  return probes;
}

/** Parses the snapshot lines, preserving their order. */
function parseSnapshot() {
  const source = readFileSync(CATALOG_FILE, "utf8");
  const start = source.indexOf(SNAPSHOT_START);
  if (start < 0) throw new Error("SNAPSHOT region not found in catalog.ts");
  const bodyStart = start + SNAPSHOT_START.length;
  const end = source.indexOf(SNAPSHOT_END, bodyStart);
  if (end < 0) throw new Error("SNAPSHOT terminator not found in catalog.ts");
  const lines = source.slice(bodyStart, end).split("\n");
  const entries = [];
  for (const line of lines) {
    const match = LINE_PATTERN.exec(line);
    if (!match) continue;
    entries.push({
      line,
      id: match[1],
      contextLength: Number(match[2]),
      maxOutputTokens: Number(match[3]),
      caps: new Set(match[4].split(" ").filter(Boolean)),
    });
  }
  return entries;
}

/** Maps a /api/show capabilities array to the snapshot capability set. */
function liveCapSet(show) {
  return new Set((Array.isArray(show?.capabilities) ? show.capabilities : [])
    .filter((value) => value === "vision" || value === "thinking" || value === "tools" || value === "completion"));
}

function liveContextLength(show) {
  const info = show?.model_info ?? {};
  const raw = Object.entries(info).find(([key]) => key.includes("context_length"))?.[1];
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
}

const main = async () => {
  const apiKey = envKey("OLLAMA_API_KEY");
  if (!apiKey) {
    log("OLLAMA_API_KEY missing from gitignored .env; cannot probe the live catalog.");
    process.exitCode = 1;
    return;
  }
  const tags = await fetchJson("https://ollama.com/api/tags", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const hostedIds = (tags.models ?? []).map((model) => model.name).filter((id) => typeof id === "string" && id);
  log(`Live /api/tags: ${hostedIds.length} hosted ids`);

  const live = new Map();
  for (const id of hostedIds) {
    try {
      const show = await fetchJson("https://ollama.com/api/show", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: id, verbose: true }),
      });
      live.set(id, { caps: liveCapSet(show), context: liveContextLength(show) });
    } catch {
      log(`WARNING: /api/show failed for ${id}; left untouched.`);
    }
  }

  const snapshot = parseSnapshot();
  const bundled = requireBundled();
  const snapshotIds = new Set(snapshot.map((entry) => entry.id));
  const removed = hostedIds.filter((id) => !snapshotIds.has(id));
  log(`Hosted ids missing from the snapshot (manual review; additions need models.dev output ceilings): ${removed.join(", ") || "none"}`);
  const stale = [...snapshotIds].filter((id) => !hostedIds.includes(id));
  if (stale.length) {
    log(`WARNING: snapshot ids absent from /api/tags (retirements need a manual CATALOG_CACHE_KEY bump and test updates): ${stale.join(", ")}`);
  }

  const lineChanges = [];
  for (const entry of snapshot) {
    const observed = live.get(entry.id);
    if (!observed) continue;
    if (observed.context !== undefined && observed.context !== entry.contextLength) {
      lineChanges.push({ entry, field: "contextLength", next: observed.context, text: `context ${entry.contextLength} -> ${observed.context}` });
    }
    const bundledSet = new Set([...entry.caps]);
    const sameSet = bundledSet.size === observed.caps.size && [...observed.caps].every((value) => bundledSet.has(value));
    if (!sameSet) {
      lineChanges.push({ entry, field: "capabilities", next: [...observed.caps].join(" "), text: `capabilities "${[...entry.caps].join(" ")}" -> "${[...observed.caps].join(" ")}"` });
    }
  }

  const probes = await probeSnapshotLimits(snapshot, hostedIds, apiKey, bundled);
  const probeCounts = { probed: 0, unproven: 0, indeterminate: 0 };
  for (const entry of snapshot) {
    const probe = probes.get(entry.id);
    if (!probe) continue;
    probeCounts[probe.status] += 1;
    if (probe.status === "indeterminate") {
      log(`WARNING: no limit probed for ${entry.id}; keeping its existing ${entry.maxOutputTokens}.`);
      continue;
    }
    if (probe.status === "unproven") {
      log(`Note: ${entry.id} accepted the top probe tier (${probe.limit}); its real limit may be higher.`);
    }
    if (probe.limit !== entry.maxOutputTokens) {
      lineChanges.push({ entry, field: "maxOutputTokens", next: probe.limit, text: `maxOutputTokens ${entry.maxOutputTokens} -> ${probe.limit}` });
    }
  }
  log(
    `Max output tokens: ${probeCounts.probed} probed, ${probeCounts.unproven} unproven (top tier accepted), ${probeCounts.indeterminate} indeterminate.`,
  );

  // Pricing drift report (plan R5): the pricing page is server-rendered, so
  // rows are regex-extracted (see src/models/pricing-drift.ts). Report-only:
  // peak/off-peak row labeling and picker price categories are hand-maintained.
  try {
    const pricingResponse = await fetch("https://ollama.com/pricing", { signal: AbortSignal.timeout(15_000) });
    if (!pricingResponse.ok) throw new Error(`https://ollama.com/pricing -> HTTP ${pricingResponse.status}`);
    const rows = bundled.pricingDrift.parsePricingRows(await pricingResponse.text());
    const { drifts, unmatchedLiveRows, unmatchedBundledIds } = bundled.pricingDrift.comparePricingRows(
      bundled.pricing.PUBLISHED_MODEL_COSTS,
      rows,
    );
    for (const drift of drifts) {
      const note = drift.mayBePeakOffPeak ? " (may be peak vs off-peak row labeling; manual review)" : "";
      log(`Pricing drift: ${drift.id}: ${drift.diffs.join(", ")}${note}`);
    }
    if (unmatchedLiveRows.length) {
      log(`Live pricing rows without a bundled entry (manual review): ${unmatchedLiveRows.join(", ")}`);
    }
    if (unmatchedBundledIds.length) {
      log(`Bundled pricing rows with no live table row (informational): ${unmatchedBundledIds.join(", ")}`);
    }
    log(drifts.length
      ? `Pricing: ${drifts.length} bundled row(s) differ from the live page; report-only — pricing is hand-maintained.`
      : "Pricing: bundled table matches the live page.");
  } catch (error) {
    log(`WARNING: pricing drift check skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const change of lineChanges) log(`Drift: ${change.entry.id}: ${change.text}`);
  if (!lineChanges.length) log("No drift; the snapshot already matches the live catalog.");

  const changedFiles = [];
  if (APPLY && lineChanges.length) {
    // Group per entry so context and capability edits to the same line compose.
    const changesByEntry = new Map();
    for (const change of lineChanges) {
      const list = changesByEntry.get(change.entry.id) ?? [];
      list.push(change);
      changesByEntry.set(change.entry.id, list);
    }
    const source = readFileSync(CATALOG_FILE, "utf8");
    let updated = source;
    for (const [, list] of changesByEntry) {
      let line = list[0].entry.line;
      for (const change of list) {
        if (change.field === "contextLength") {
          line = line.replace(/(?<=contextLength: )\d+/, String(change.next));
        } else if (change.field === "maxOutputTokens") {
          line = line.replace(/(?<=maxOutputTokens: )\d+/, String(change.next));
        } else {
          line = line.replace(/(?<=capabilities: ")[^"]*(?=")/, change.next);
        }
      }
      updated = updated.replace(list[0].entry.line, line);
    }
    if (updated !== source) {
      writeFileSync(CATALOG_FILE, updated);
      changedFiles.push("src/models/catalog.ts", writeChangeset());
      log(`Applied updates to: ${changedFiles.join(", ")}`);
    }
  } else if (APPLY) {
    log("Nothing to apply.");
  }

  if (CREATE_PR) await createPullRequest(changedFiles);
};

function writeChangeset() {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, ".changeset", `resync-model-metadata-${date}.md`);
  const body = `---\n"ollama-cloud-copilot-chat": patch\n---\n\n${CHANGESET_SUMMARY}\n`;
  if (!existsSync(file) || readFileSync(file, "utf8") !== body) writeFileSync(file, body);
  return path.relative(ROOT, file);
}

async function createPullRequest(changedFiles) {
  if (!changedFiles.length) {
    log("No drift to commit; skipping PR.");
    return;
  }
  const run = (name, args) => {
    const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8" });
    if (result.status) throw new Error(`${name} ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout.trim();
  };
  const date = new Date().toISOString().slice(0, 10);
  const branch = `resync/models-${date}`;
  if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    throw new Error("--pr must run from a clean checkout of main");
  }
  run("git", ["checkout", "-b", branch]);
  run("git", ["add", "--", ...changedFiles]);
  run("git", ["commit", "-m", "Resync model metadata"]);
  run("git", ["push", "-u", "origin", branch]);
  const bodyPath = path.join(process.env.TMPDIR ?? "/tmp", `${path.basename(ROOT)}-${process.pid}-resync-pr.md`);
  writeFileSync(bodyPath, `${report.join("\n")}\n`);
  const created = spawnSync(
    "gh",
    ["pr", "create", "--head", branch, "--base", "main", "--title", "Resync model metadata from live sources", "--body-file", bodyPath],
    { cwd: ROOT, encoding: "utf8" },
  );
  log(created.stdout.trim() || created.stderr.trim());
  run("git", ["checkout", "main"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

if (reportPath) {
  writeFileSync(reportPath, `${report.join("\n")}\n`);
}
