# Limitations & Unfinished Parts

Everything this engine does **not** do, and why. Organized by *why*:

- **§1 — Capped by the 2-hour timebox.** Things we'd do with more time.
- **§2 — Capped by missing business context.** Things that need a product decision
  before being implemented.
- **§3 — Out of scope by design.** Things this module deliberately doesn't own.

The goal isn't to handwave gaps — it's to be explicit about *what's missing and why*, so
the reviewer (and any future implementer) knows where the holes are.

---

## §1 — What more time would buy

### 1.1 Runtime input validation
**Today:** TypeScript guards the type contract at compile time. Runtime payloads are
trusted.
**Next:** add Zod schemas at the entry of `buildPostCallDecision`, parse-don't-validate
style. Reject malformed input loudly.
**Cost:** ~30 min + a new dep.

### 1.2 Property-based tests
**Today:** 99 tests, all example-based.
**Next:** add `fast-check` to assert invariants like "for all inputs, `runAt >= now`",
"for all inputs, output is deeply equal to a second call with the same input"
(determinism), "for all inputs, `scheduledActions` is sorted".
**Cost:** ~1h + a dev dep.

### 1.3 Mutation testing
**Today:** good test coverage, but no proof the tests catch arbitrary mutations.
**Next:** wire `stryker-mutator` and target ≥ 80% mutation score on `src/classify.ts`
and `src/planActions.ts`.
**Cost:** ~2h setup + tuning.

### 1.4 Coverage report
**Today:** Vitest is configured for coverage but no script wires it up.
**Next:** add `pnpm coverage` script; gate CI at ≥ 90%.
**Cost:** ~15 min.

### 1.5 ADRs for the 3-4 key decisions
**Today:** rationale lives in `docs/design.md` and `tradeoffs.md`.
**Next:** convert to numbered ADRs in `docs/adr/` for nicer browsability.
**Cost:** ~30 min, mostly reformatting.

### 1.6 Window crossing midnight (`22:00-02:00`)
**Today:** we detect `start ≥ end` and fall back to the default window with a warning.
**Next:** support proper midnight-crossing windows as a union of two intervals.
**Cost:** ~45 min in `scheduling.ts` + 4-5 new tests.

---

## §2 — What needs business decisions before implementation

These are the most important entries in this file. The engine is *capable* of handling
each item below — the question is what the **correct behavior** should be, and that's a
product call, not an engineering one.

### 2.1 Public holiday policy
**Today:** `manual_review` is scheduled for the next morning at 09:00 Paris,
skipping weekends only if the window forbids them. A French national holiday on the
target day is **not** detected.
**Open questions:**
- Should `manual_review` skip French public holidays? Bank holidays? Custom Voxfit
  closures?
- If yes — push to next business day, or push to specific opening hours?
- Should the same policy apply to retry calls, or only to `manual_review`?

### 2.2 Retry budget across multiple calls on the same case
**Today:** the engine only knows `step.attemptsSoFar` and `step.maxAttempts`. A case
might have already burned through five calls *on a previous step*; the engine has no
visibility into that.
**Open questions:**
- Should there be a per-case lifetime cap (e.g. "no more than 12 calls ever, regardless
  of step")?
- If a case has 3 attempts on step A and 3 on step B, do they cumulate?
- Should max-attempts behavior differ by outcome (e.g. permissive on `voice_mail`,
  strict on `disputed`)?

### 2.3 Time-of-day for `manual_review`
**Today:** 09:00 Paris time on the next valid day.
**Open questions:**
- Is 09:00 actually when the human operator opens their queue? Or is it earlier/later?
- Should the time differ by case priority or amount?

### 2.4 Summary truncation cap (2000 chars)
**Today:** hard-coded.
**Open questions:**
- Is 2000 the right cap for downstream storage?
- Should the truncation be transcript-aware (cut at the last full sentence)?
- Should the full summary be preserved elsewhere (call record) when truncated?

### 2.5 Refinement of the `unknown` bucket
**Today:** any outcome that doesn't match the known list lands as `unknown` →
`manual_review`.
**Open questions:**
- What outcomes have we observed in production that *should* be classified but aren't?
- Should we be more aggressive about classifying (more rules) or more cautious (more
  manual reviews)? This depends on the cost of a wrong automated decision vs the cost
  of a human review.

### 2.6 Multi-currency cases
**Today:** `case.currency` is recorded but no check is done across signals.
**Open questions:**
- Can a single case have heterogeneous-currency tool events (e.g. a EUR amount
  promised but a USD payment link sent)?
- If so, is that a warning, an error, or a normal scenario?

### 2.7 Permanent exclusion side effects
**Today:** `do_not_call` and `wrong_contact` set `case.status = perm_excluded` and no
further actions are scheduled.
**Open questions:**
- Should an outbound notification be sent to the case owner?
- Should the engine produce an event for downstream systems (CRM update, audit trail)?
- Today the engine returns a patch; the side-effect is the caller's responsibility. Is
  that the right boundary?

### 2.8 Disputed cases
**Today:** `disputed` → `temp_excluded` + `manual_review` next morning.
**Open questions:**
- Should disputed cases be flagged for legal review specifically?
- Should the dispute reason (from the transcript) be persisted with the case patch?

### 2.9 "Promise to pay" with a payment date too far in the future
**Today:** any future date is honored, even "promised payment on 2030-01-01".
**Open questions:**
- What's the maximum acceptable promise window? 6 months? 1 year?
- Beyond that, should we warn or refuse the promise?

### 2.10 What happens if all signals are absent
**Today:** `unknown` → `manual_review`.
**Open questions:**
- This case probably indicates an upstream bug (no telephony, no transcript, no tool
  events). Should it page someone? Just log? Treat as failure?

---

## §3 — Deliberately out of scope

These would be wrong for this module to own.

### 3.1 Persistence
The engine returns patches; it doesn't write to a database. Callers integrate.

### 3.2 Real Twilio/Stripe/OpenAI/database integration
The sujet says explicitly to skip this. We honor that.

### 3.3 Authentication / authorization
Callers handle this before invoking the engine.

### 3.4 Real-world transcript content evaluation
The engine reads the `insights.outcome` string as already-extracted. The transcript-to-
outcome extraction (the LLM call) is somebody else's module.

### 3.5 PII redaction
If the summary contains PII, that's a redactor's job to handle upstream. The engine
just truncates length.

### 3.6 Internationalization
Audit messages and warning text are English only. A future i18n pass would template
them; not relevant for a take-home reviewed in English.

### 3.7 Observability / metrics emission
The engine returns data. Emitting Prometheus metrics, traces, or logs is the caller's
choice.

---

## Reviewer note

If you (Voxfit) are reviewing this and a §2 item matters more than a §1 item — say so.
The right next move is to clarify the business decisions in §2 before adding more
engineering polish from §1. The engineering is straightforward once the product
intent is fixed; the inverse is not true.
