# Voxfit — Post-Call Decision Engine

> Take-home exercise. A deterministic TypeScript module that turns post-call signals
> (telephony, transcript-derived insights, tool events, case context) into a normalized
> decision: what the outcome was, how the case should move, and what to schedule next.

## TL;DR

```ts
import { buildPostCallDecision } from "voxfit-post-call-decision-engine";

const decision = buildPostCallDecision(input);
// → { normalizedOutcome, casePatch, scheduledActions, callPatch, warnings, auditLog }
```

Pure function. No I/O. No clock reads. Same input → same output.

## Run it

Requires Node 20+. Uses **pnpm**.

```sh
pnpm install
pnpm test         # run all tests once
pnpm test:watch   # TDD loop
pnpm typecheck    # tsc --noEmit
pnpm check        # typecheck + test
```

## Where to look

- [`docs/design.md`](docs/design.md) — problem framing, decomposition, choices, tradeoffs.
- [`src/classify.ts`](src/classify.ts) — signal cascade (telephony overrides AI).
- [`src/scheduling.ts`](src/scheduling.ts) — Luxon-based time / TZ / DST helpers.
- [`src/planActions.ts`](src/planActions.ts) — outcome → case patches + scheduled actions.
- [`src/buildPostCallDecision.ts`](src/buildPostCallDecision.ts) — the orchestrator.
- [`tests/edge-cases.test.ts`](tests/edge-cases.test.ts) — explicit edge cases from the sujet.

## Approach in one paragraph

A pipeline of three pure functions — `classify`, `planActions`, glued by
`buildPostCallDecision` — chosen for testability (each layer tested in isolation),
determinism (everything is a transform of inputs, including `now`), and explainability
(every branch drops one audit line). Time arithmetic uses Luxon so that DST in
`Europe/Paris` doesn't lie. The classification cascade is order-sensitive: telephony
safety signals (`amdStatus`, `status`, `durationSec`) override AI insights — we don't
trust a transcript-extracted "promise to pay" on a call that never connected.

## Assumptions and tradeoffs

- **Input is trusted-shaped.** TypeScript guards the boundary; no runtime JSON-schema
  validation. In a real service we'd add Zod. Out of scope at 2h.
- **Audit log is plain English.** Not i18n. Reviewer-readable beats production-ready here.
- **`manual_review` is scheduled the next morning at 09:00 Paris time.** No business-day
  logic beyond "skip weekends if the step's call window forbids them". A real system
  would honor holidays.
- **Retry budget is per-case, not per-channel.** Only the simple "max attempts reached"
  check is enforced.
- **One reminder per decision.** The engine never emits more than one
  `payment_reminder` even with duplicate `send_payment_link` events.

## Known limitations

- No persistence, no Twilio/Stripe/OpenAI integration (out of scope per sujet).
- The `unknown` outcome bucket is wide — anything we can't classify lands there with a
  manual-review action. A production system would refine this taxonomy with telemetry.
- DST is correct for `Europe/Paris` (IANA tz). Other zones would require a different
  policy on `paymentReminderAt`.

## How I used AI

This solution was built with Claude Code (Opus 4.7). The AI:

- proposed the three-layer decomposition (`classify` / `scheduling` / `planActions`)
  after reading the sujet;
- generated test cases **first** for each module (TDD discipline);
- implemented the modules to make the tests pass;
- drafted audit messages and warnings.

I (the human) validated:

- the **cascade order** in `classify` against the sujet's section 1 — telephony-safety
  outcomes must win over AI-derived ones. Pushed back on an earlier draft that put
  `Stop contact` above `voice_mail`.
- the **DST behavior** for `Europe/Paris` 2025 by spot-checking the spring-forward day
  (March 30) and fall-back day (October 26) in the scheduling tests.
- every assertion in `tests/edge-cases.test.ts` before letting the implementation pass.
- the **determinism contract** by reviewing all `src/` files for any `new Date()` or
  `Date.now()` reads (there are none — `now` is always an argument).

What I did **not** delegate: the choice of architecture (pipeline of pure functions),
the choice of dep (Luxon), and the choice to keep the spec doc small but explicit
rather than producing a heavy ADR set.
