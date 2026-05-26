# Business Rules

The single source of truth for what the engine does and why. If you change a rule, change
this doc in the same commit. Rules are tagged with the test file(s) that verify them.

## Hierarchy

The engine is a three-layer pipeline. Rules apply at the layer that owns the decision:

```
validate  →  classify  →  planActions
(warn)       (outcome)    (state + schedule)
```

Each layer is a pure function. `now` is always an input — no clock reads.

---

## R1 — Telephony safety overrides AI

**Layer:** `classify`
**Tests:** `tests/classify.test.ts` (telephony block)

The first match wins, in this order:

1. `call.amdStatus` contains `"machine"` or `"voicemail"` (case-insensitive) → `voice_mail`
2. `call.status` ∈ {`no-answer`, `busy`, `failed`} → `no_answer`

A transcript-extracted "Accepted full payment later" is **ignored** when the call did not
connect to a human. This is a safety property — never trust the LLM about what a person
said if the telephony layer says the person never spoke.

## R2 — Outcome mapping from insights

**Layer:** `classify`
**Tests:** `tests/classify.test.ts` (insight outcome mapping)

Strict-equality mapping (no fuzzy matching) — keeps the engine deterministic and review-friendly.

| `insights.outcome` | Normalized outcome |
|---|---|
| `Stop contact` | `do_not_call` |
| `Incorrect contact information` | `wrong_contact` |
| `Debt dispute` | `disputed` |
| `Debt payment refusal` | `uncooperative` |
| `Accepted full payment now` | `wait_payment_confirmation` |
| `Accepted full payment later` | `promise_to_pay` |
| `Accepted payment plan later` | `promise_to_pay` |
| `Call rescheduled` | `callback_scheduled` |

If no outcome string matches, the engine looks at tool events (R3) and `callbackAt` (R4).

## R3 — Successful payment-link tool events

**Layer:** `classify`
**Tests:** `tests/classify.test.ts` (tool events block)

A successful `send_payment_link` or `send_payment_plan_link` tool event → `wait_payment_confirmation`,
but only when no insight outcome already matched. The outcome string is the stronger signal.

## R4 — Callback inference

**Layer:** `classify`
**Tests:** `tests/classify.test.ts` (callbackAt inference)

A valid (parseable) `insights.callbackAt` without an explicit outcome → `callback_scheduled`.

## R5 — Early termination guard

**Layer:** `classify`
**Tests:** `tests/classify.test.ts`, `tests/edge-cases-extra.test.ts` (B4)

`call.durationSec > 0 && call.durationSec < 7` with no stronger signal → `early_termination`.
Negative durations are **not** classified as early termination (R7 validates and warns).

## R6 — Fallback

**Layer:** `classify`

Anything else → `unknown`. Always reaches a `manual_review` action through `planActions`.

---

## R7 — Input validation

**Layer:** `validate` (runs before classify)
**Tests:** `tests/edge-cases-extra.test.ts` (B-series + C10, C12)

Each validation emits a warning **and** an audit line, but never blocks classification:

| Condition | Warning |
|---|---|
| `input.timezone !== "Europe/Paris"` | Falls back to Europe/Paris |
| `call.durationSec < 0` | Negative duration ignored |
| `call.performedAt > now` | Possible clock skew |
| `case.amountRemaining ≤ 0` | Case may be settled or overpaid |
| `step.callWindow.start ≥ end` (or unparseable) | Falls back to default 08:00–20:00 weekdays |

---

## R8 — Permanent exclusions

**Layer:** `planActions`
**Tests:** `tests/planActions.test.ts` (permanent exclusions block)

| Outcome | Action |
|---|---|
| `do_not_call` | `case.status = perm_excluded`, reason `"Recipient asked to stop contact"`, no scheduled actions |
| `wrong_contact` | `case.status = perm_excluded`, reason `"Incorrect contact information"`, no scheduled actions |

## R9 — Temporary exclusions and scheduling

**Layer:** `planActions`
**Tests:** `tests/planActions.test.ts`

The outcome → action table. All `runAt` values are UTC ISO strings, never in the past.

| Outcome | `case.status` | Scheduled actions |
|---|---|---|
| `promise_to_pay` | `temp_excluded` | `payment_reminder` 09:00 Paris on `paymentDate` (when valid + future) + follow-up `call` after `promiseFollowupDelayDays` |
| `wait_payment_confirmation` | `temp_excluded` | One `payment_reminder` next morning at 09:00 Paris |
| `callback_scheduled` | `temp_excluded` | `call` at `callbackAt` snapped to call window (warning when snapped or fallback) |
| `disputed` | `temp_excluded` | `manual_review` next morning |
| `uncooperative` | `temp_excluded` | `call` after `retryDelayHours` |
| `early_termination` | `temp_excluded` | `call` after `retryDelayHours` |
| `no_answer` / `voice_mail` (attempts < max) | `temp_excluded` | `call` after `retryDelayHours` |
| `no_answer` / `voice_mail` (attempts ≥ max) | `temp_excluded` | `manual_review` + max-attempts warning |
| `unknown` | `temp_excluded` | `manual_review` + warning |

## R10 — Already-excluded case guard

**Layer:** `planActions`
**Tests:** `tests/planActions.test.ts` (already-excluded guard)

If `case.status` is already `perm_excluded` or `completed`:
- No state change (patch is `{ nextActionAt: null }` only).
- No scheduled actions.
- One warning (`Case is already <status>; no further actions scheduled`).

This is a defensive read of state — if the engine is called on a stopped case, refuse to
restart it. (In production, an upstream filter would prevent this; the engine is the last line.)

## R11 — Tool event handling

**Layer:** `planActions` (`summarizeToolEvents`)
**Tests:** `tests/planActions.test.ts` (tool events), `tests/edge-cases-extra.test.ts` (D14, D15)

- Events are **deduplicated** by `id` when present, else by `(name, status, createdAt)`.
- A successful `send_payment_link` or `send_payment_plan_link` sets `callPatch.paymentLinkSent = true` (idempotent).
- A failed event emits a warning + audit line. State is not changed.
- Different `name` values are **not** considered duplicates even if semantically related.

## R12 — Scheduling: time, timezone, DST

**Layer:** `scheduling` (used by `planActions`)
**Tests:** `tests/scheduling.test.ts`, `tests/edge-cases.test.ts` (DST block)

- All wall-clock arithmetic uses Luxon with `zone: "Europe/Paris"`.
- Output `runAt` is always serialized to UTC ISO (`...Z`).
- `paymentReminderAt(date, now)`:
  - Returns 09:00 Paris time on the given date.
  - On a CET day (winter): `08:00:00.000Z`.
  - On a CEST day (summer): `07:00:00.000Z`.
  - Returns `null` for invalid or past dates.
- `snapToCallWindow(target, ...)`:
  - In-window targets are returned unchanged.
  - Out-of-window or past targets are advanced to the next valid window opening; `adjusted: true`.
  - Window-end is **exclusive**: a target at `18:00:00.000` on a `10:00-18:00` window snaps forward.

## R13 — Determinism and output stability

**Layer:** orchestrator (`buildPostCallDecision`)
**Tests:** `tests/buildPostCallDecision.test.ts` (determinism)

- Same input → same output (deep equality).
- `auditLog` order is **source-order**: `validate → classify → plan`.
- `scheduledActions` are stable-sorted by `runAt` ascending.
- `casePatch.nextActionAt` = first scheduled action's `runAt`, or `null` if none.

## R14 — Defense in depth on inputs embedded in logs

**Layer:** `planActions` (`sanitize`, `truncate`)
**Tests:** `tests/edge-cases-extra.test.ts` (E16, E17)

- Tool event `name` and `createdAt` are sanitized (control chars stripped) before being
  embedded in warnings/audit so that downstream log consumers can't be tricked by
  embedded newlines.
- `callPatch.summary` is truncated to **2000 characters** with a trailing `…` if longer.
  Protects against transcript dumps that pollute output payloads.
