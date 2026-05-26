# `.claude/` — Development tooling (dev-meta branch only)

This directory exists **only on the `dev-meta` branch**. On `main` we kept the repo
focused on the deliverable Voxfit will review; this branch shows the full Claude Code
setup used during development.

## Contents

- **`dispatcher.md`** — Routing logic for a Claude Code orchestrator. When a question
  lands on this repo, match it to a category (operational / code-lookup / rationale /
  feature / audit) and dispatch to the right subagent. Includes 5 worked examples from
  simple to most pointed.
- **`agents/`** — Five specialized subagents, each with a tight responsibility:
  - `runtime-helper.md` — install, run, test, build (Haiku, fastest)
  - `code-explorer.md` — read-only "what does X do" lookups
  - `arch-explainer.md` — "why was Y chosen" using `docs/design.md` and `AI_USAGE.md`
  - `feature-extender.md` — file-by-file change plans for new features (plan only, no edits)
  - `rules-reviewer.md` — audit code vs. business rules vs. the original sujet
- **`../CLAUDE.md`** (repo root, shipped on `main` too) — hard rules for any Claude
  Code session: TDD, no clock reads, audit log contract.

## Why a separate branch

A heavy `.claude/` setup signals "over-engineering" to a take-home reviewer who has
seven other submissions to read. By keeping it off `main` we:

1. Let the reviewer see the **deliverable** (engine + tests + docs) without distraction.
2. Show the **process** to anyone curious enough to check this branch.
3. Get the benefits of the tooling without polluting the artifact.

## How to use it on `dev-meta`

Start a Claude Code session in this directory. The orchestrator should read
`dispatcher.md` first and route every incoming question. The five example questions in
that file describe the full coverage envelope.

To merge any change from `dev-meta` into `main`, only the `src/`, `tests/`, and `docs/`
trees should ever cross over. `.claude/` stays on this branch.
