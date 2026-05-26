# Design — Post-Call Decision Engine

> Spec for the Voxfit take-home. Written **before** any implementation code, then revisited
> as choices got validated against tests.

## 1. Problem framing

After each AI voice call, Voxfit's system has to decide *what should happen next* to the case.
The inputs are imperfect:

- **Telephony metadata** (status, duration, AMD result) is reliable but coarse.
- **AI-derived insights** (outcome, promised payment date, callback time) are richer but
  fallible — the LLM can hallucinate a "promise to pay" on a call where nobody picked up.
- **Tool events** record real side effects (a payment link was actually sent).
- **Case context** carries business state (status, remaining amount, preferred window).

The engine must produce a **deterministic, explainable, safe** decision: a normalized outcome,
patches to the case and the call, scheduled follow-up actions, warnings, and an audit log.

### Why this is non-trivial despite looking simple

1. **Signals conflict.** Transcript says "Accepted full payment later" but `status` is `no-answer`.
   The transcript must be ignored — extraction can't be trusted when the human never spoke.
2. **Time is the hard part.** "Schedule a `payment_reminder` at 09:00 Paris time on date X"
   crosses a DST boundary twice a year. Naïve `new Date()` arithmetic gives wrong wall-clock
   times on those days.
3. **Idempotence matters.** Duplicate tool events arrive in production — webhooks retry. We
   must not double-schedule.
4. **Explainability is a hard requirement.** Every branch taken must drop a line in
   `auditLog`. This is almost as much code as the logic itself.

## 2. Decomposition

Three layers, each a pure function:

```
PostCallInput
     │
     ▼
[ classify ]  ── signal cascade ──► normalizedOutcome + reasoning
     │                                    (telephony overrides AI)
     ▼
[ planActions ]  ── outcome + context ──► casePatch + scheduledActions
     │                                       + warnings
     ▼                              (uses scheduling helpers)
[ buildPostCallDecision ]  ── glue ──► PostCallDecision
```

Each layer:

- **Receives `now`** as an argument. No `Date.now()` anywhere internal → tests are stable.
- **Returns its own audit lines.** The orchestrator concatenates them in source order.
- **Has no I/O.** Everything is in-memory data transformation.

### Why a pipeline of pure functions and not a "rule engine"

A declarative rule engine sounds clean ("declare rules, the engine evaluates") but in a 2h
take-home it introduces an abstraction layer the reviewer has to learn before reading the
actual rules. The signal cascade in classify.ts *is* a priority-ordered set of rules; encoding
it as a small ordered array of `(predicate, outcome, auditMessage)` triples gives 80% of the
declarative benefit at 20% of the conceptual cost.

## 3. The classification cascade

Order matters — the **first match wins** so the engine is deterministic even when signals
conflict:

1. **Telephony safety overrides** (cannot be beaten by AI):
   - `amdStatus` mentions machine/voicemail → `voice_mail`
   - `status` in {`no-answer`, `busy`, `failed`} → `no_answer`
2. **Insights-derived outcomes** (only when telephony said the call connected to a human):
   - "Stop contact" → `do_not_call`
   - "Incorrect contact information" → `wrong_contact`
   - "Debt dispute" → `disputed`
   - "Debt payment refusal" → `uncooperative`
   - "Accepted full payment now" OR a successful `send_payment_link` tool event
     → `wait_payment_confirmation`
   - "Accepted full payment later" / "Accepted payment plan later" → `promise_to_pay`
   - "Call rescheduled" OR valid `callbackAt` → `callback_scheduled`
3. **Early termination guard**: human-connected but `durationSec < 7` and no stronger
   outcome above → `early_termination`.
4. **Fallback**: `unknown`.

Telephony-safety outcomes win over insight outcomes by design — see section 1.

## 4. Time, timezones, DST

We use **Luxon** rather than `Date`. Reasons:

- `Date` has no concept of named time zones; you can only ask "what is *this* instant in
  UTC offset X" — but offsets change on DST days.
- Luxon's `DateTime.fromISO(..., { zone: "Europe/Paris" })` and `.set({ hour: 9, minute: 0 })`
  give us actual wall-clock semantics. "09:00 Paris time on March 30, 2025" works correctly
  on the DST switch day where 02:00 doesn't exist.
- It's small (~20kB gzip) and stable.

**Scheduling rules implemented in `scheduling.ts`:**

- `nextRunAtInWindow(target, callWindow, now)`: returns the next instant matching the step's
  call window (days + start/end). If `target` is in the past *or* outside the window, snaps
  forward to the next valid slot. Adds a warning when adjusted.
- `paymentReminderAt(date, zone)`: returns `09:00:00.000` Paris time on the given date.
- `addRetryDelay(now, hours, callWindow)`: for retries after no-answer.
- **All return ISO strings in UTC** (`.toUTC().toISO()`) so the output is single-format.

## 5. Case state transitions

Encoded as a single mapping `normalizedOutcome → case state effect`:

| Outcome                       | Case status         | Schedules                          |
|-------------------------------|---------------------|------------------------------------|
| `do_not_call`                 | `perm_excluded`     | none                               |
| `wrong_contact`               | `perm_excluded`     | none                               |
| `disputed`                    | `temp_excluded`     | `manual_review` next business day  |
| `promise_to_pay`              | `temp_excluded`     | `payment_reminder` on promise date + follow-up call after `promiseFollowupDelayDays` |
| `wait_payment_confirmation`   | `temp_excluded`     | `payment_reminder` next morning    |
| `callback_scheduled`          | `temp_excluded`     | `call` at callback time (snapped to window) |
| `uncooperative`               | `temp_excluded`     | `call` after `retryDelayHours`     |
| `no_answer` / `voice_mail`    | `temp_excluded`     | `call` after `retryDelayHours` *unless* max attempts reached → `manual_review` + warning |
| `early_termination`           | `temp_excluded`     | `call` after `retryDelayHours`     |
| `unknown`                     | `temp_excluded`     | `manual_review` + warning          |

Guard rails:

- If `case.status === "perm_excluded"` already, **no further actions** are scheduled and a
  warning is added (we shouldn't have called this case in the first place).
- If `case.status === "completed"`, same guard.

## 6. Idempotence on tool events

`paymentLinkSent` is a boolean — it's already idempotent. The risk is **duplicate scheduled
actions** when two `send_payment_link` events arrive. Mitigations:

- We never emit more than one `payment_reminder` per decision (the loop short-circuits after
  the first match).
- Tool events are deduplicated by `id` (when present) or by `(name, status, createdAt)`
  composite key before being read.

## 7. Determinism contract

- `now` is always passed in; never read from the clock.
- Outputs use UTC ISO-8601 (`Z` suffix). No locale-dependent formats.
- `auditLog` order is **source order**: validate → classify → plan. Stable per input.
- `scheduledActions` are stable-sorted by `runAt` ascending.

## 8. What's intentionally **not** done (timebox)

- No JSON schema validation of the input. We trust TypeScript at the boundary and document
  the assumption.
- No persistence, no I/O, no Twilio/Stripe stubs.
- No internationalization of audit messages — English only.
- No retry budget across multiple calls (only the simple "max attempts reached" check).
- No business-day logic for `manual_review` scheduling — uses next morning at 09:00 Paris.

## 9. Test strategy

Each module has its own unit test file. One integration file (`buildPostCallDecision.test.ts`)
asserts the public API. One dedicated `edge-cases.test.ts` covers the conflicts the sujet
explicitly asks about:

1. **Transcript says promise-to-pay but `status` is `no-answer`** → telephony wins.
2. **Invalid ISO `callbackAt`** → warning, fallback to retry-delay schedule.
3. **Past `paymentDate`** → no past schedule, warning, treated as no payment date.
4. **Already `perm_excluded` case** → no actions, single warning.
5. **Duplicate `send_payment_link` tool events** → single `paymentLinkSent: true`,
   no duplicate `payment_reminder`.
6. **DST boundary** — payment reminder on the day of the spring-forward correctly returns
   `08:00Z` (instead of `07:00Z` in winter or wrong `09:00Z` from naïve arithmetic).

## 10. AI usage and verification policy

This project is being built with Claude Code. The AI:

- proposed the layered decomposition;
- wrote test cases first (TDD);
- wrote the implementations;
- generated the audit messages.

The human (David) validates:

- the **classification cascade order** — is "telephony overrides AI" actually the right
  business call? (Yes, confirmed against sujet section 1.)
- the **DST behavior** — manually checked against `tzdb` boundaries for Europe/Paris 2025.
- the **edge cases** — read every `edge-cases.test.ts` assertion and confirmed it matches
  intent before letting the implementation pass.

A README "How I used AI" section documents this.
