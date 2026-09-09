# Changelog

## v1.0.0 — 2026-09-08

First release.

- Composite action, zero dependencies, Node 20 built-in `fetch`.
- Resolves the repository's own listing via `GET https://satohub.ai/api/resolve?repo=` and writes score / tier / slug / verify_url outputs.
- Checks npm packages (`packages`, plus `package.json` dependencies + devDependencies by default) and GitHub repositories (`repos`) against the same resolver.
- Fails on retired listings (`fail-on-deprecated`, default on) and optionally below a score (`fail-below`); warns below `warn-below` (default 40).
- Markdown table in the job summary; `::warning::` / `::error::` annotations.
- Optional README badge refresh between `<!-- sato-score-badge:start -->` / `<!-- sato-score-badge:end -->` markers. Never commits.
- Sequential requests, 15 s timeout each, at most 60 checks per run. A network failure is reported as unknown and never fails the job.
