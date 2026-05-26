# CLAUDE.md — voxfit-post-call-decision-engine

Guidance for any Claude Code session working on this repo.

## What this is

A **2-hour take-home** for Voxfit. A single pure module: `buildPostCallDecision(input)`.
No services, no I/O. Deterministic, testable, explainable. See `docs/design.md` for the
problem framing and decomposition.

## Hard rules (don't break)

1. **TDD.** Every new behavior gets a failing test before any production code. RED → GREEN
   → REFACTOR. No exceptions.
2. **No `new Date()` or `Date.now()` in `src/`.** Time enters through the `now` argument.
   This is what makes the engine deterministic. Tests will catch leaks but don't rely on
   that — be vigilant.
3. **All `runAt` strings are UTC ISO-8601 with `Z` suffix.** Wall-clock arithmetic happens
   in Luxon with `zone: "Europe/Paris"`; the boundary serializes to UTC.
4. **Functions stay pure.** No mutation of inputs. Build new objects.
5. **The classification cascade is order-sensitive.** Telephony safety overrides win. Don't
   reorder without a corresponding spec change.
6. **Every branch taken drops one line in `auditLog`.** This is the explainability contract.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess: true`. Don't silence with `!` — handle the
  case.
- Filenames in `src/` are camelCase and one concept per file.
- Tests live in `tests/` mirroring `src/` names (`classify.ts` → `classify.test.ts`).
- Audit messages are short, machine-greppable English sentences without trailing periods.
- Warnings are user-facing-ish: short, capitalized, no jargon.

## Running

```sh
pnpm install
pnpm test       # one-shot
pnpm test:watch # TDD loop
pnpm typecheck
pnpm check      # typecheck + test
```

## Decision log

Substantive choices live in `docs/design.md` sections 4 (time/TZ), 5 (state transitions),
and 8 (out-of-scope). If you change one of those, update the doc in the same commit.
