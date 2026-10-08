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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const APPLY = argv.includes("--apply") || argv.includes("--pr");
const CREATE_PR = argv.includes("--pr");
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
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return undefined;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim();
  return value || undefined;
}

function requireBundled() {
  const resolved = path.join(ROOT, "out", "models/catalog.js");
  if (!existsSync(resolved)) {
    const compiled = spawnSync("npm", ["run", "compile"], { cwd: ROOT, encoding: "utf8" });
    if (compiled.status) {
      console.error(compiled.stderr);
      process.exit(compiled.status ?? 1);
    }
  }
  return {
    catalog: require_(resolved),
    metadata: require_(path.join(ROOT, "out", "models/metadata.js")),
  };
}

const LINE_PATTERN = /{ id: "([^"]+)", contextLength: (\d+), maxOutputTokens: (\d+), capabilities: "([^"]*)" }/;

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
        line = change.field === "contextLength"
          ? line.replace(/(?<=contextLength: )\d+/, String(change.next))
          : line.replace(/(?<=capabilities: ")[^"]*(?=")/, change.next);
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