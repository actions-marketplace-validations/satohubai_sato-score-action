<div align="center">

# ⬡ Sato Score Action

**Check the crypto-agent tooling your repo depends on, and keep your Sato Score badge current.**

Composite action · zero dependencies · no token · keyless

**[satohub.ai/sato-score](https://satohub.ai/sato-score?utm_source=github&utm_medium=action&utm_campaign=sato-score-action)** · **[the index](https://github.com/satohubai/onchain-agents)** · **[satohub.ai](https://satohub.ai?utm_source=github&utm_medium=action&utm_campaign=sato-score-action)**

</div>

---

Sato Hub keeps a daily-rebuilt index of the onchain agent stack: frameworks, MCP servers, wallets, payment rails, trading venues, data. Every listed project carries a **Sato Score** — a 0–100 measure of how open, active and verifiable it is. Not a safety, quality or returns grade.

This action asks the index two questions on every run:

1. **Is this repository listed?** If so, it exposes the score, tier and report URL as outputs and (optionally) rewrites the badge in your README.
2. **What about the dependencies?** Each npm package and GitHub repo you name — plus your `package.json` dependencies by default — is resolved against the index. A **retired** listing fails the job. A score **below a threshold** warns, or fails if you say so. A dependency with **no listing** is reported and nothing more: most dependencies are not crypto-agent tooling, and that is expected.

The resolver only matches exactly (a listing's GitHub owner/name, or a package its deploy spec installs). Nothing fuzzy — a wrong hit would put the wrong score on someone's README.

## Quick start

### Badge only

Add the markers to your README once:

```md
<!-- sato-score-badge:start -->
<!-- sato-score-badge:end -->
```

Then:

```yaml
name: sato-score
on:
  schedule:
    - cron: "0 8 * * 1"   # weekly refresh
  workflow_dispatch:

permissions:
  contents: write

jobs:
  badge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: satohubai/sato-score-action@v1
        with:
          update-badge: "true"
          package-json: "false"        # badge only, skip the dependency check
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: refresh Sato Score badge"
          file_pattern: README.md
```

The action writes the badge; it never commits. Pair it with a commit step (above) or open a PR from the change. The badge itself is a Shields endpoint badge, so it updates on its own as the score moves — the refresh only matters if the link or slug changes.

You can also paste the badge by hand without this action:

```md
[![Sato Score](https://img.shields.io/endpoint?url=https%3A%2F%2Fsatohub.ai%2Fapi%2Fbadge%2F<slug>.json)](https://satohub.ai/verify/<slug>)
```

### Dependency gate

```yaml
name: sato-score
on: [push, pull_request]

jobs:
  deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: satohubai/sato-score-action@v1
        with:
          # package.json dependencies + devDependencies are read by default.
          packages: |
            solana-agent-kit
            @coinbase/agentkit
          repos: |
            coinbase/agentkit
            https://github.com/sendaifun/solana-agent-kit
          fail-on-deprecated: "true"   # a retired listing fails the job
          fail-below: "30"             # a listed dependency under 30 fails
          warn-below: "50"             # under 50 warns
```

### Weekly cron: gate + badge, committed back

```yaml
name: sato-score
on:
  schedule:
    - cron: "0 8 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  weekly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: sato
        uses: satohubai/sato-score-action@v1
        with:
          update-badge: "true"
          fail-below: "30"
      - uses: stefanzweifel/git-auto-commit-action@v5
        if: always()
        with:
          commit_message: "chore: refresh Sato Score badge (${{ steps.sato.outputs.score }})"
          file_pattern: README.md
```

Every run prints a table to the job summary — name, score, tier, status, verify link — with the caveat under it.

## Inputs

All optional.

| Input | Default | What it does |
|---|---|---|
| `repo` | `${{ github.repository }}` | The repository whose OWN listing is resolved. Feeds the badge and the `score` / `tier` / `slug` / `verify_url` outputs. `owner/name` or a GitHub URL. |
| `packages` | — | npm package names to check. Newline- or comma-separated. |
| `repos` | — | GitHub repositories to check. `owner/name` or URLs, newline- or comma-separated. |
| `package-json` | `package.json` if it exists | Path to a `package.json`; its `dependencies` + `devDependencies` names are checked. Set to `false` to opt out. |
| `fail-on-deprecated` | `true` | Fail the job when a checked dependency's listing is retired (the resolver answers `410`). |
| `fail-below` | — | Integer 0–100. Fail when a listed dependency scores below this. Empty = never fail on score. |
| `warn-below` | `40` | Integer 0–100. Warn when a listed dependency scores below this. |
| `update-badge` | `false` | Rewrite the README between `<!-- sato-score-badge:start -->` / `<!-- sato-score-badge:end -->`. Only when the repo's own listing resolves. Never commits. |
| `readme` | `README.md` | Path of the README the badge is written into. |

## Outputs

| Output | Meaning |
|---|---|
| `score` | Sato Score of the repo's own listing (integer), or empty. |
| `tier` | `High` / `Medium` / `Low`, or empty. |
| `slug` | Sato Hub slug of the repo's own listing, or empty. |
| `verify_url` | Public report: `https://satohub.ai/verify/<slug>`, or empty. |
| `deprecated` | Comma-separated identifiers of checked dependencies whose listing is retired. |
| `below_threshold` | Comma-separated identifiers of checked dependencies scoring below `fail-below`. |
| `unlisted_count` | Number of checked dependencies with no listing. Informational. |
| `report` | The markdown report written to the job summary. |

## How it behaves

- **Exit 1 only** when `fail-on-deprecated` is on and a retired listing was found, or when a listed dependency scores below `fail-below`. Nothing else fails the job.
- **Unlisted is not a verdict.** A `404` from the resolver means no listing matches. It is counted and shown, never failed on.
- **Unknown is not a failure.** A timeout or network error is reported as `unknown` with a warning. The action does not fail your build because a third-party endpoint was slow.
- **Rate-limit friendly.** Requests run one at a time, each with a 15 s timeout, and a run checks at most **60** dependencies (the rest are skipped with a warning — split them across jobs). Duplicates are collapsed.
- **Annotations.** Retired listings and below-`fail-below` scores are `::error::`; below-`warn-below`, unknowns and skipped inputs are `::warning::`.
- **No token, no secrets.** Both endpoints are public and keyless: `GET https://satohub.ai/api/resolve?repo=…|package=…` and `GET https://satohub.ai/api/badge/<slug>.json`. Nothing about your repository is sent beyond the identifiers you asked it to check.

## What this does NOT do

- It does **not** assess safety. A Sato Score of 90 says the project is open, active and verifiable by public evidence on the day it was computed. It says nothing about whether the code is correct, whether the keys it handles are safe, or whether anything built on it will make money. Use an auditor and a security scanner for those questions.
- It does **not** scan your code, lockfile or transitive dependencies. It resolves the names you pass (and top-level `package.json` names) against the index, nothing deeper.
- It does **not** commit. Pair it with a commit or PR action.
- It does **not** invent matches. If your project is not listed, the summary links to the [submit form](https://satohub.ai/submit).

> The Sato Score is a 0–100 measure of how open, active and verifiable a project is. Not a safety, quality or returns grade. Methodology: [satohub.ai/sato-score](https://satohub.ai/sato-score).

## Local test

```sh
node test/run.mjs
```

Runs `src/main.mjs` the way GitHub does (inputs as `INPUT_*` env vars, `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` files) against the live resolver, then asserts on the summary, outputs and README rewrite. Node 20+.

## Publishing (Sato Hub account)

For whoever holds the `satohubai` account. Marketplace listing is self-serve; there is no review queue.

1. Push this repository public as `satohubai/sato-score-action` with `action.yml` at the root.
2. Tag the release: `git tag v1.0.0 && git tag v1 && git push origin v1.0.0 v1`. Keep the floating `v1` tag moving to the latest `v1.x.y` on every release so `@v1` users get fixes.
3. On GitHub, open the **Releases** tab → **Draft a new release** → choose tag `v1.0.0` → tick **Publish this Action to the GitHub Marketplace**.
4. GitHub checks that `action.yml` has a unique name, description, `branding`, and that the repo has a README and a license. All are in place.
5. Primary category: **Continuous integration**. Secondary: **Code quality**.
6. Publish. The listing appears at `github.com/marketplace/actions/sato-score`.

Later releases: tag `v1.x.y`, move `v1`, publish the release with the Marketplace box ticked again.

## License

MIT © Sato Hub. See [LICENSE](./LICENSE).
