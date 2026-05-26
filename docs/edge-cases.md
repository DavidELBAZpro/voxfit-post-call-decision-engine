# Edge Cases

Tracks every edge case considered. Each entry: **what could go wrong** + **how the engine
behaves** + **where it's tested** (or why we chose not to handle it).

Organized in two parts:
- **§A — From the sujet** (Voxfit's "Edge Cases To Consider" list)
- **§B — Additional cases** (found during brainstorming, see `docs/design.md` §3)

---

## §A — Edge cases listed in the sujet

### A.1 Conflicting signals
> *"transcript says payment accepted but call status is no-answer"*

**Behavior:** Telephony layer wins. We never trust an AI-extracted outcome on a call
that didn't connect to a human.
**Tests:** `tests/edge-cases.test.ts`, `tests/classify.test.ts` (telephony block).

### A.2 Invalid dates
> *"callbackAt or paymentDate that won't parse"*

**Behavior:**
- `paymentDate` invalid → reminder skipped + warning. Follow-up call still scheduled.
- `callbackAt` invalid → fallback to `retryDelayHours` delayed call + warning.

**Tests:** `tests/edge-cases.test.ts` (invalid dates).

### A.3 Past callback / payment dates

**Behavior:**
- Past `paymentDate` → reminder skipped + warning (we never schedule in the past).
- Past `callbackAt` → snapped forward to next valid window slot + warning.

**Tests:** `tests/edge-cases.test.ts` (past dates).

### A.4 Already permanently excluded cases

**Behavior:** No state change, no scheduled actions, single warning.

**Tests:** `tests/edge-cases.test.ts`, `tests/planActions.test.ts`.

### A.5 Duplicate tool events

**Behavior:** Deduplicated by `id` when present, else by `(name, status, createdAt)`.
`paymentLinkSent` is idempotent. We never emit more than one `payment_reminder` per decision.

**Tests:** `tests/edge-cases.test.ts`, `tests/planActions.test.ts`.

### A.6 Missing optional fields

**Behavior:** All optional fields have safe defaults — engine runs with the minimum input
shape.

**Tests:** `tests/edge-cases.test.ts` (missing optional fields).

### A.7 Boundary times near end of call window

**Behavior:** Window end is **exclusive**. A target at exactly the end-time is snapped
forward to the next valid morning.

**Tests:** `tests/edge-cases.test.ts`, `tests/edge-cases-extra.test.ts` (C13).

### A.8 Daylight saving and timezone handling

**Behavior:** All wall-clock arithmetic uses Luxon with `zone: "Europe/Paris"`. Reminder
at 09:00 Paris time produces:
- `08:00Z` in CET (winter).
- `07:00Z` in CEST (summer).
- Correct on the spring-forward and fall-back days (March 30 and October 26, 2025).

**Tests:** `tests/scheduling.test.ts`, `tests/edge-cases.test.ts` (DST block).

---

## §B — Additional edge cases (brainstormed)

### Category A — Conflicting signals not in the sujet

#### B-A1 — `Stop contact` outcome + successful `send_payment_link`
**Behavior:** Outcome wins (`do_not_call` → `perm_excluded`). The tool event becomes
irrelevant because the case is permanently excluded.
**Why:** Honoring the recipient's explicit "stop" is a legal/ethical hard constraint that
outranks any operational signal.
**Tests:** `tests/edge-cases-extra.test.ts` (A1).

#### B-A2 — `Accepted full payment now` + failed `send_payment_link`
**Behavior:** Still classifies `wait_payment_confirmation` (the human accepted), but
`paymentLinkSent` stays `false` and a warning surfaces the tool failure.
**Why:** Don't drop the human's commitment just because plumbing failed. Operator sees the
warning and can resend the link manually.
**Tests:** `tests/edge-cases-extra.test.ts` (A2).

### Category B — Doubtful input validity

#### B-B4 — `durationSec` negative
**Behavior:** Not classified as `early_termination` (sub-7-second guard now requires
`> 0`). Warning emitted.
**Why:** Defensive — telephony data with negative duration is corrupt; don't propagate
the corruption into decisions.
**Tests:** `tests/edge-cases-extra.test.ts` (B4).

#### B-B5 — `durationSec` very large (not handled)
**Behavior:** No special handling. The number ends up in the audit log if classify
references it. Not a correctness risk — just cosmetic.
**Why:** Out of scope. The interesting threshold is "did the call connect?" — large
durations only ever pass that gate more clearly.

#### B-B6 — `call.performedAt > now`
**Behavior:** Warning emitted ("clock skew suspected"). Classification continues.
**Why:** Future-dated calls usually mean clock skew between the engine host and telephony
provider. Better to flag than ignore.
**Tests:** `tests/edge-cases-extra.test.ts` (B6).

#### B-B7 — `case.amountRemaining ≤ 0`
**Behavior:** Warning ("case may be settled or overpaid"). No automatic state change.
**Why:** Could be a settled case being called by mistake, or an overpayment to refund.
Both need human review; the engine flags but doesn't decide on intent.
**Tests:** `tests/edge-cases-extra.test.ts` (B7).

#### B-B8 — `maxAttempts: 0`
**Behavior:** Math holds (`attemptsSoFar + 1 ≥ 0`) → immediate `manual_review`.
**Why:** A configured value of 0 means "no automated attempts allowed" — escalate.
**Tests:** `tests/edge-cases-extra.test.ts` (B8).

#### B-B9 — `retryDelayHours` ≤ 0
**Behavior:** Falls back to 24h.
**Why:** Negative or zero delay would schedule in the past. Default is the safe choice.
**Tests:** `tests/edge-cases-extra.test.ts` (B9), `tests/scheduling.test.ts`.

### Category C — Time / timezone

#### B-C10 — `input.timezone !== "Europe/Paris"`
**Behavior:** Warning emitted; engine falls back to Europe/Paris for all scheduling.
**Why:** The DST policy is Paris-specific; honoring other zones would require a
configurable `paymentReminderAt`. Out of scope.
**Tests:** `tests/edge-cases-extra.test.ts` (C10).

#### B-C11 — Scheduling inside the DST gap (e.g. 02:30 Paris on Mar 30 2025)
**Behavior:** Luxon's default behavior is to advance out of the gap. The output is a
valid UTC ISO instant.
**Why:** No correct local interpretation exists for a time inside the gap. Advance > skip > error.
**Tests:** `tests/edge-cases-extra.test.ts` (C11).

#### B-C12 — Call window with `start ≥ end` (or unparseable)
**Behavior:** Warning emitted; falls back to default `08:00-20:00` weekdays.
**Why:** A window crossing midnight is not represented by our `start < end` model.
Document the limitation rather than silently misbehave.
**Tests:** `tests/edge-cases-extra.test.ts` (C12).

#### B-C13 — Target at exactly the window end (e.g. 18:00:00 on a `10-18` window)
**Behavior:** Snapped forward (end is exclusive). Warning emitted.
**Why:** Avoid scheduling a call that would start at the closing minute and run past.
Exclusive end is the standard interval convention.
**Tests:** `tests/edge-cases-extra.test.ts` (C13).

### Category D — Deduplication

#### B-D14 — `send_payment_link` AND `send_payment_plan_link` both success
**Behavior:** Different `name` values → not considered duplicates. `paymentLinkSent: true`
once, single `payment_reminder` scheduled.
**Why:** They are different products (one-off link vs payment-plan link); dedup by name
would lose information. The reminder is bounded by outcome, not by tool count.
**Tests:** `tests/edge-cases-extra.test.ts` (D14).

#### B-D15 — Events differing by milliseconds
**Behavior:** Different `createdAt` → not considered duplicates. Idempotence of
`paymentLinkSent` and outcome-driven reminders means this doesn't matter.
**Why:** Stricter dedup would risk silently dropping real retries. Operator-side dedup
is more appropriate.
**Tests:** `tests/edge-cases-extra.test.ts` (D15).

### Category E — Robustness

#### B-E16 — `insights.outcome` or tool event `name` with control characters
**Behavior:** `sanitize()` strips `\r`, `\n`, `\t`, and ASCII C0 controls before embedding
strings in `warnings` and `auditLog`.
**Why:** If `auditLog` is ever joined by `\n` and shipped to a log aggregator, a
malicious newline could fabricate fake log entries. Defense in depth.
**Tests:** `tests/edge-cases-extra.test.ts` (E16).

#### B-E17 — `insights.summary` very long (e.g. 5000 chars of transcript dump)
**Behavior:** Truncated to 2000 chars with trailing `…`.
**Why:** Caller payloads should not pollute downstream storage. 2000 is a soft cap.
**Tests:** `tests/edge-cases-extra.test.ts` (E17).

---

## Cases acknowledged but not handled (timebox)

| Case | Why not | What we'd do with +1h |
|---|---|---|
| Window crossing midnight (`22:00-02:00`) | Out of scope for take-home | Detect via `start ≥ end` and apply two intervals (today: start→23:59, tomorrow: 00:00→end) |
| Holidays / business-day logic | Country-dependent, no clean API | Add `date-holidays` and filter `manual_review` to next business day |
| `paymentDate` = today and `now` > 09:00 | Currently returns `null` (past reminder) — reasonable | Schedule reminder for the next day morning + warning |
| Multiple `paymentDate` sources (insights + a hypothetical `payment_promise` tool event) | Not in the sujet schema | Reconcile with most-recent timestamp, warn on conflict |
| Multi-currency cases (e.g. case in EUR, tool event in USD) | Not in the sujet schema | Validate currency match across signals |
| Audit log redaction (PII in summary) | No PII detector built-in | Plug a redactor before truncation |
