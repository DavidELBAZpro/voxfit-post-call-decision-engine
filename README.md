# Voxfit — Post-Call Decision Engine

> Take-home exercise. A deterministic TypeScript module that turns post-call signals
> (telephony, transcript-derived insights, tool events, case context) into a normalized
> decision: outcome, case state patch, scheduled actions, warnings, audit log.

**Status:** 109 tests (99 unit + 10 end-to-end JSON scenarios), all green. Strict
TypeScript, zero `any`, zero clock reads in `src/`. Coverage
[**96% / 90% / 97% / 96%**](https://htmlpreview.github.io/?https://github.com/DavidELBAZpro/voxfit-post-call-decision-engine/blob/main/docs/coverage/index.html)
(statements / branches / functions / lines — click to browse the full HTML report).

## Pipeline

```mermaid
flowchart LR
    Input([PostCallInput])
    Output([PostCallDecision])

    subgraph Pipeline[" "]
        direction LR
        V[validate<br/><i>safety warnings</i>]
        C[classify<br/><i>signal cascade</i>]
        P[planActions<br/><i>state + schedule</i>]
        V --> C --> P
    end

    Input --> V
    P --> Output
    P -. uses .-> S[scheduling<br/><i>Luxon · Paris TZ · DST</i>]

    classDef layer fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef helper fill:#fce7f3,stroke:#be185d,color:#831843
    classDef io fill:#f5f5f4,stroke:#57534e,color:#1c1917
    class V,C,P layer
    class S helper
    class Input,Output io
```

Four pure functions (`validate`, `classify`, `scheduling`, `planActions`) glued by a
15-line orchestrator. `now` is always an input — same input → same output.

## Run it

Requires Node 20+. Uses **pnpm**.

```sh
pnpm install
pnpm test         # all 109 tests once
pnpm test:watch   # TDD loop
pnpm typecheck    # tsc --noEmit
pnpm coverage     # v8 coverage (90% thresholds)
pnpm bench        # latency + throughput per scenario
pnpm check        # typecheck + test (CI runs this)
```

CI is **manual-only** (workflow_dispatch). Trigger it from the GitHub Actions tab,
choose the branch (`main` or `dev-meta`). See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Scenarios

Ten self-contained JSON fixtures in [`scenarios/`](scenarios/) — each one is a full
`PostCallInput` plus the expected `PostCallDecision` for a different outcome
(`promise_to_pay`, `voicemail`, `stop-contact`, `callback` snapped to window,
DST boundary day, ...).

```sh
pnpm test scenarios                       # run all 10 at once
pnpm test scenarios -t "stop-contact"     # run a single named scenario
```

Adding a new case: drop a new `.json` file in `scenarios/` — no test code change. See
[`scenarios/README.md`](scenarios/README.md) for the format and what each existing
scenario exercises.

## Benchmark (in brief)

`pnpm bench` runs Vitest's native bench runner across the 10 scenarios plus a focused
fast-path-vs-slow-path duel. Captured on a MacBook (M1-class), Node 22.15:

| Code path | Throughput | Mean | p99 |
|---|---|---|---|
| Fast path (`perm_excluded` short-circuit, no Luxon) | **~2.7M ops/s** | 0.4 µs | 0.5 µs |
| Typical (no_answer, voicemail, callback, dispute) | 40–57k ops/s | 18–24 µs | 23–31 µs |
| Heavy (`promise_to_pay` + reminder + follow-up) | ~22k ops/s | 44 µs | 63 µs |
| Worst (DST spring-forward day) | ~15k ops/s | 65 µs | 94 µs |

All paths sub-millisecond p99. RME < 1.1% (measurements are stable). The fast path is
**~118× faster** than the slow path — proof that the `perm_excluded` guard short-circuits
all the Luxon work as intended.

Full methodology and Voxfit-specific interpretation (fleet sizing, why this matters for
real-time voice) in [`docs/performance.md`](docs/performance.md).

## Ask this codebase questions (on `dev-meta`)

The [`dev-meta`](https://github.com/DavidELBAZpro/voxfit-post-call-decision-engine/tree/dev-meta)
branch ships a Q&A concierge: switch to it and launch your AI assistant with a
natural-language question. It reads `.claude/dispatcher.md`, identifies the category,
and either answers directly or routes to one of five specialized subagents.

```sh
git checkout dev-meta
[Your AI Assistant] "Hi, what can you do?"
```

The first reply is always a self-introduction. From there, ask anything:

```
> Why was Luxon chosen over native Date?
> Is the negative duration edge case handled?
> What's the current test coverage percent?
> How would I add a new outcome called callback_no_show?
> Is the cascade order in classify.ts correct given sujet §1?
> What's missing that needs a product decision?
```

Covers: project goals, architecture, design rationale, edge cases (covered or not),
test coverage, file-by-file extension plans, and audits against the business rules.

## Documentation

- [`docs/design.md`](docs/design.md) — problem framing, decomposition, architecture rationale
- [`docs/business-rules.md`](docs/business-rules.md) — 14 codified rules tagged to the tests that verify them
- [`docs/edge-cases.md`](docs/edge-cases.md) — every edge case considered (sujet + brainstormed)
- [`docs/tradeoffs.md`](docs/tradeoffs.md) — choices made + what was given up
- [`docs/limitations.md`](docs/limitations.md) — what's not done and why (§2 = decisions needed from product)
- [`docs/performance.md`](docs/performance.md) — bench results + interpretation
- [`docs/coverage/`](docs/coverage/) — last HTML coverage snapshot ([open online](https://htmlpreview.github.io/?https://github.com/DavidELBAZpro/voxfit-post-call-decision-engine/blob/main/docs/coverage/index.html))
