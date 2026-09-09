#!/usr/bin/env node
// sato-score-action — dependency-and-badge check against Sato Hub.
// Zero dependencies. Node 20+ (built-in fetch). Inputs arrive as INPUT_<NAME>
// environment variables, exactly as GitHub Actions passes them.
//
// The Sato Score is a 0-100 measure of how open, active and verifiable a
// project is. It is not a safety, quality or returns grade. This script never
// says otherwise.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const API = process.env.SATO_API_BASE || "https://satohub.ai";
const TIMEOUT_MS = 15_000;
const MAX_CHECKS = 60;
const CAVEAT =
  "The Sato Score is a 0-100 measure of how open, active and verifiable a project is. Not a safety, quality or returns grade.";
const MARK_START = "<!-- sato-score-badge:start -->";
const MARK_END = "<!-- sato-score-badge:end -->";

// ---------- inputs ----------

function input(name, fallback = "") {
  const up = name.toUpperCase();
  const v = process.env[`INPUT_${up}`] ?? process.env[`INPUT_${up.replace(/-/g, "_")}`];
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}
function boolInput(name, fallback) {
  const v = input(name, "").toLowerCase();
  if (v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}
function intInput(name, fallback) {
  const v = input(name, "");
  if (v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    warn(`Input ${name} must be an integer 0-100; got "${v}". Ignoring.`);
    return fallback;
  }
  return n;
}
function listInput(name) {
  return input(name, "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- GitHub Actions plumbing ----------

function esc(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function warn(msg) { console.log(`::warning::${esc(msg)}`); }
function error(msg) { console.log(`::error::${esc(msg)}`); }
function notice(msg) { console.log(`::notice::${esc(msg)}`); }

function setOutput(name, value) {
  const v = value == null ? "" : String(value);
  const file = process.env.GITHUB_OUTPUT;
  if (!file) { console.log(`[output] ${name}=${v.split("\n")[0]}`); return; }
  const delim = `ghadelim_${Math.random().toString(36).slice(2)}`;
  appendFileSync(file, `${name}<<${delim}\n${v}\n${delim}\n`);
}
function writeSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + "\n");
  else console.log("\n" + md);
}

// ---------- resolver ----------

function normalizeRepo(s) {
  let v = s.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = v.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (m) return `${m[1]}/${m[2]}`;
  return v;
}

async function resolveOne(kind, value) {
  const url = `${API}/api/resolve?${kind}=${encodeURIComponent(value)}`;
  let res, body;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "sato-score-action/1.0 (+https://github.com/satohubai/sato-score-action)" },
    });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = {}; }
  } catch (e) {
    return { kind, value, status: "unknown", note: `network: ${e?.name || "error"}` };
  }
  if (res.status === 200) {
    return {
      kind, value, status: "listed",
      slug: body.slug, name: body.name,
      score: Number.isInteger(body.sato_score) ? body.sato_score : null,
      tier: body.sato_tier || "",
      verify_url: body.verify_url, sato_url: body.sato_url,
      badge_json_url: body.badge_json_url,
    };
  }
  if (res.status === 404) return { kind, value, status: "unlisted", submit_url: body.submit_url };
  if (res.status === 410) {
    return { kind, value, status: "deprecated", slug: body.slug, name: body.name, sato_url: body.sato_url, note: body.note };
  }
  if (res.status === 400) return { kind, value, status: "invalid", note: body.error };
  return { kind, value, status: "unknown", note: `HTTP ${res.status}` };
}

// ---------- package.json ----------

function readPackageJsonDeps(path) {
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  } catch (e) {
    warn(`Could not read ${path}: ${e.message}`);
    return [];
  }
}

// ---------- badge ----------

function badgeMarkdown(own) {
  const endpoint = encodeURIComponent(own.badge_json_url || `${API}/api/badge/${own.slug}.json`);
  return `[![Sato Score](https://img.shields.io/endpoint?url=${endpoint})](${own.verify_url})`;
}

function updateReadme(readmePath, own) {
  if (!existsSync(readmePath)) {
    warn(`update-badge: ${readmePath} not found; nothing written.`);
    return false;
  }
  const src = readFileSync(readmePath, "utf8");
  const a = src.indexOf(MARK_START);
  const b = src.indexOf(MARK_END);
  if (a === -1 || b === -1 || b < a) {
    warn(`update-badge: add the markers ${MARK_START} and ${MARK_END} to ${readmePath} to enable the badge refresh.`);
    return false;
  }
  const inner = `\n${badgeMarkdown(own)}\n`;
  const next = src.slice(0, a + MARK_START.length) + inner + src.slice(b);
  if (next === src) { console.log("update-badge: README already current."); return false; }
  writeFileSync(readmePath, next);
  notice(`update-badge: wrote the Sato Score badge into ${readmePath}. Commit it with a commit step; this action never commits.`);
  return true;
}

// ---------- report ----------

function label(r) {
  return r.name ? `${r.name} (\`${r.value}\`)` : `\`${r.value}\``;
}
function statusCell(r, failBelow, warnBelow) {
  switch (r.status) {
    case "listed": {
      if (r.score == null) return "listed, no score";
      if (failBelow != null && r.score < failBelow) return `below fail threshold (${failBelow})`;
      if (warnBelow != null && r.score < warnBelow) return `below warn threshold (${warnBelow})`;
      return "listed";
    }
    case "deprecated": return "retired";
    case "unlisted": return "not listed";
    case "invalid": return "invalid input";
    default: return `unknown (${r.note || "no response"})`;
  }
}
function row(r, failBelow, warnBelow) {
  const score = r.score == null ? "—" : String(r.score);
  const tier = r.tier || "—";
  const link = r.verify_url ? `[report](${r.verify_url})` : r.sato_url ? `[listing](${r.sato_url})` : "—";
  return `| ${label(r)} | ${score} | ${tier} | ${statusCell(r, failBelow, warnBelow)} | ${link} |`;
}

// ---------- main ----------

async function main() {
  const repoInput = input("repo", process.env.GITHUB_REPOSITORY || "");
  const packages = listInput("packages");
  const repos = listInput("repos").map(normalizeRepo);
  const pkgJsonInput = input("package-json", "");
  const failOnDeprecated = boolInput("fail-on-deprecated", true);
  const failBelow = intInput("fail-below", null);
  const warnBelow = intInput("warn-below", 40);
  const updateBadge = boolInput("update-badge", false);
  const readmePath = resolvePath(input("readme", "README.md"));

  // package.json: default when present, opt out with "false".
  let pkgJsonDeps = [];
  if (pkgJsonInput.toLowerCase() !== "false") {
    const p = resolvePath(pkgJsonInput || "package.json");
    if (pkgJsonInput || existsSync(p)) pkgJsonDeps = readPackageJsonDeps(p);
  }

  // Build the check list (dedupe, cap).
  const seen = new Set();
  const checks = [];
  for (const p of [...packages, ...pkgJsonDeps]) {
    const k = `package:${p}`; if (!seen.has(k)) { seen.add(k); checks.push({ kind: "package", value: p }); }
  }
  for (const r of repos) {
    const k = `repo:${r.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); checks.push({ kind: "repo", value: r }); }
  }
  let truncated = 0;
  if (checks.length > MAX_CHECKS) { truncated = checks.length - MAX_CHECKS; checks.length = MAX_CHECKS; }
  if (truncated) warn(`${truncated} check(s) skipped: at most ${MAX_CHECKS} per run to stay polite to the resolver. Split them across jobs.`);

  // Own listing first, then sequential checks.
  let own = null;
  if (repoInput) {
    own = await resolveOne("repo", normalizeRepo(repoInput));
    console.log(`own listing: ${own.status}${own.slug ? ` (${own.slug})` : ""}`);
  }
  const results = [];
  for (const c of checks) {
    const r = await resolveOne(c.kind, c.value);
    results.push(r);
    console.log(`${c.kind} ${c.value}: ${r.status}${r.score != null ? ` score=${r.score}` : ""}`);
  }

  // Verdicts.
  const deprecated = results.filter((r) => r.status === "deprecated");
  const below = results.filter((r) => r.status === "listed" && r.score != null && failBelow != null && r.score < failBelow);
  const warned = results.filter((r) => r.status === "listed" && r.score != null && warnBelow != null && r.score < warnBelow && !below.includes(r));
  const unlisted = results.filter((r) => r.status === "unlisted");
  const unknown = results.filter((r) => r.status === "unknown");

  for (const r of deprecated) {
    const msg = `${r.name || r.value}: listing retired on Sato Hub${r.note ? ` — ${r.note}` : ""}`;
    failOnDeprecated ? error(msg) : warn(msg);
  }
  for (const r of below) error(`${r.name || r.value}: Sato Score ${r.score} is below fail-below ${failBelow}`);
  for (const r of warned) warn(`${r.name || r.value}: Sato Score ${r.score} is below warn-below ${warnBelow}`);
  for (const r of unknown) warn(`${r.value}: could not be checked (${r.note}). Reported as unknown, not as a failure.`);

  // Badge.
  if (updateBadge) {
    if (own?.status === "listed") updateReadme(readmePath, own);
    else warn(`update-badge: ${repoInput || "this repository"} has no listing on Sato Hub (${own?.status || "not resolved"}); badge not written.${own?.submit_url ? ` Submit it: ${own.submit_url}` : ""}`);
  }

  // Summary.
  const lines = [];
  lines.push("## Sato Score");
  if (own) {
    if (own.status === "listed") {
      lines.push(`**${own.name}** — score **${own.score ?? "—"}** · tier ${own.tier || "—"} · [report](${own.verify_url})`);
    } else if (own.status === "deprecated") {
      lines.push(`**${own.name || repoInput}** — listing retired${own.sato_url ? ` ([listing](${own.sato_url}))` : ""}`);
    } else if (own.status === "unlisted") {
      lines.push(`\`${repoInput}\` is not listed on Sato Hub. [Submit it](${own.submit_url || API + "/submit"}).`);
    } else {
      lines.push(`\`${repoInput}\`: ${statusCell(own)}`);
    }
    lines.push("");
  }
  if (results.length) {
    lines.push(`### Dependencies checked (${results.length})`);
    lines.push("");
    lines.push("| Name | Score | Tier | Status | Verify |");
    lines.push("|---|---|---|---|---|");
    const order = { deprecated: 0, listed: 1, unknown: 2, invalid: 3, unlisted: 4 };
    for (const r of [...results].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))) lines.push(row(r, failBelow, warnBelow));
    lines.push("");
    if (unlisted.length) lines.push(`${unlisted.length} not listed — informational only. Most dependencies are not crypto-agent tooling and are not expected to have a listing.`);
    if (unknown.length) lines.push(`${unknown.length} unknown — the resolver could not be reached in time. Unknown never fails the job.`);
    lines.push("");
  } else {
    lines.push("No dependencies were checked. Pass `packages`, `repos`, or a `package-json` path.");
    lines.push("");
  }
  lines.push(`> ${CAVEAT}`);
  const report = lines.join("\n");
  writeSummary(report);

  // Outputs.
  setOutput("score", own?.status === "listed" ? own.score ?? "" : "");
  setOutput("tier", own?.status === "listed" ? own.tier : "");
  setOutput("slug", own?.slug || "");
  setOutput("verify_url", own?.status === "listed" ? own.verify_url : "");
  setOutput("deprecated", deprecated.map((r) => r.value).join(","));
  setOutput("below_threshold", below.map((r) => r.value).join(","));
  setOutput("unlisted_count", unlisted.length);
  setOutput("report", report);

  // Exit.
  const failed = (failOnDeprecated && deprecated.length > 0) || below.length > 0;
  if (failed) {
    console.log(`Failing: ${deprecated.length} retired, ${below.length} below ${failBelow}.`);
    process.exit(1);
  }
  console.log("Done.");
}

main().catch((e) => {
  // An unexpected crash in the action itself is not a verdict about anyone's code.
  warn(`sato-score-action crashed: ${e?.message || e}. Reported as unknown, not as a failure.`);
  process.exit(0);
});
