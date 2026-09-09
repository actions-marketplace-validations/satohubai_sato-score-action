#!/usr/bin/env node
// Local test: runs src/main.mjs the way GitHub Actions does (INPUT_* env vars,
// GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files) against the LIVE resolver, then
// asserts on the summary. Usage: node test/run.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const main = join(here, "..", "src", "main.mjs");
const dir = mkdtempSync(join(tmpdir(), "sato-score-action-"));
const summary = join(dir, "summary.md");
const output = join(dir, "output.txt");
const readme = join(dir, "README.md");
writeFileSync(summary, "");
writeFileSync(output, "");
writeFileSync(readme, "# demo\n\n<!-- sato-score-badge:start -->\n<!-- sato-score-badge:end -->\n");

let failures = 0;
function assert(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

// Case 1: warn-only, listed + unlisted mix, own repo = a listed one so the badge path runs.
{
  const res = spawnSync(process.execPath, [main], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "satohubai/sato-score-action",
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_REPO: "coinbase/agentkit",
      INPUT_PACKAGES: "solana-agent-kit, express",
      INPUT_REPOS: "coinbase/agentkit\nhttps://github.com/nonexistent/nothing-here-xyz",
      "INPUT_PACKAGE-JSON": "false",
      "INPUT_FAIL-ON-DEPRECATED": "false",
      "INPUT_WARN-BELOW": "40",
      "INPUT_UPDATE-BADGE": "true",
      INPUT_README: readme,
    },
    encoding: "utf8",
  });
  console.log("--- stdout (case 1) ---\n" + res.stdout + (res.stderr ? "--- stderr ---\n" + res.stderr : ""));
  const md = readFileSync(summary, "utf8");
  const out = readFileSync(output, "utf8");
  const rd = readFileSync(readme, "utf8");
  console.log("--- summary ---\n" + md + "\n--- outputs ---\n" + out + "\n--- README ---\n" + rd);

  assert(res.status === 0, "exit code 0 in warn-only mode");
  assert(/coinbase-agentkit/.test(md) || /coinbase\/agentkit/.test(md), "summary mentions coinbase agentkit");
  assert(/Coinbase AgentKit \(`coinbase\/agentkit`\) \| \d+ \|/.test(md), "coinbase/agentkit row has an integer score");
  assert(/Solana Agent Kit \(`solana-agent-kit`\) \| \d+ \|/.test(md), "solana-agent-kit row has an integer score");
  assert(/`express` \| — \| — \| not listed/.test(md), "express reported as not listed (informational)");
  assert(/not a safety, quality or returns grade/i.test(md), "summary carries the caveat");
  assert((md.match(/Not a safety, quality or returns grade/g) || []).length === 1, "caveat appears exactly once");
  assert(/^score<<.*\n\d+\n/m.test(out), "score output is an integer");
  assert(/^slug<<.*\ncoinbase-agentkit\n/m.test(out), "slug output is coinbase-agentkit");
  assert(/^unlisted_count<<.*\n2\n/m.test(out), "unlisted_count is 2");
  assert(/img\.shields\.io\/endpoint\?url=https%3A%2F%2Fsatohub\.ai%2Fapi%2Fbadge%2Fcoinbase-agentkit\.json/.test(rd), "README badge written with shields endpoint");
  assert(/\]\(https:\/\/satohub\.ai\/verify\/coinbase-agentkit\)/.test(rd), "README badge links to verify_url");
}

// Case 2: fail-below trips on a listed dependency.
{
  writeFileSync(summary, ""); writeFileSync(output, "");
  const res = spawnSync(process.execPath, [main], {
    env: {
      ...process.env,
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      INPUT_REPO: "", INPUT_PACKAGES: "solana-agent-kit", "INPUT_PACKAGE-JSON": "false",
      "INPUT_FAIL-BELOW": "100",
    },
    encoding: "utf8",
  });
  const out = readFileSync(output, "utf8");
  assert(res.status === 1, "exit code 1 when a dependency is below fail-below");
  assert(/::error::/.test(res.stdout), "emits ::error:: annotation");
  assert(/^below_threshold<<.*\nsolana-agent-kit\n/m.test(out), "below_threshold output names the package");
}

// Case 3: network failure is unknown, never a fail.
{
  writeFileSync(summary, ""); writeFileSync(output, "");
  const res = spawnSync(process.execPath, [main], {
    env: {
      ...process.env,
      SATO_API_BASE: "http://127.0.0.1:9",
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      INPUT_REPO: "coinbase/agentkit", INPUT_PACKAGES: "solana-agent-kit", "INPUT_PACKAGE-JSON": "false",
      "INPUT_FAIL-BELOW": "100",
    },
    encoding: "utf8",
  });
  const md = readFileSync(summary, "utf8");
  assert(res.status === 0, "exit code 0 when the resolver is unreachable");
  assert(/unknown/.test(md), "summary reports unknown");
}

console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
process.exit(failures ? 1 : 0);
