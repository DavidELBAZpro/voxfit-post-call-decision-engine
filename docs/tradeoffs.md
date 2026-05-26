# Tradeoffs & Assumptions

Every meaningful decision in this engine, why it was made, and what was given up.

> Pair-read with `docs/business-rules.md` (what the engine does) and `limitations.md`
> (what it explicitly doesn't do).

---

## 1. Architecture: pipeline of three pure functions

**Choice:** `classify` → `planActions`, glued by `buildPostCallDecision`. Each layer is
a pure function returning data + audit lines.

**Alternatives considered:** monolithic function with branching; rule engine with declared
predicates.

**Why this choice:** the three layers map to real domain concepts (the call's *meaning*,
the *time math*, the *case-state effect*). Testing each in isolation is trivial; testing a
monolith would require fragile setup.

**Given up:** a tiny bit of indirection (one extra function hop between classify and
planActions). For a 2h take-home, a rule engine would have been over-engineering — it
buys configurability we don't need.

## 2. Time library: Luxon

**Choice:** Luxon over native `Date` and over `date-fns-tz`.

**Why:** native `Date` has no concept of named time zones — only offsets — so the rule
"09:00 Paris time on date X" is provably wrong on DST days. Luxon's IANA-aware API
(`DateTime.fromISO(..., { zone: "Europe/Paris" })`) makes this correct by construction.
`date-fns-tz` works but Luxon's API is cleaner for this domain. Verified against the
2025 DST boundary days (March 30, October 26).

**Given up:** 20 kB gzipped. Acceptable for a domain where date correctness is a hard
requirement.

## 3. Cascade order: telephony overrides AI

**Choice:** When `call.status` or `call.amdStatus` indicates the call didn't connect to a
human, **discard the transcript outcome entirely**. The cascade short-circuits at the
telephony check before reading insights.

**Why:** never trust an LLM-extracted "promise to pay" on a call where nobody spoke.
This is a **safety property**, not an optimization. The sujet's §1 ("Telephony Safety
Overrides") explicitly mandates this order.

**Given up:** edge cases where the transcript holds late-arriving audio that's correct
even when status is wrong. A reviewer of false-positives could re-classify offline.

## 4. Window-end is exclusive

**Choice:** A call window `10:00-18:00` accepts targets at 17:59:59.999 but **not**
18:00:00.000.

**Why:** standard interval convention `[start, end)`. Avoids scheduling a call that
starts at the closing minute and overruns into off-hours.

**Given up:** a millisecond of expressiveness at the boundary. Documented in
`docs/edge-cases.md` (B-C13).

## 5. Manual review = next morning at 09:00 Paris (not business-day-aware)

**Choice:** `nextManualReviewAt` returns the next-day 09:00 Paris time, **skipping
weekends** only if the call window's `days` forbid them. No public-holiday awareness.

**Why:** business-day logic is country-dependent and requires a maintained holiday
calendar. For a 2h take-home, the simpler "skip weekends per window" is the right
amount.

**Given up:** correctness on holidays. A `manual_review` scheduled for a Monday
might fall on a public holiday. **Need product decision** on the policy (skip holidays?
push to next business day? business-hour-specific?).

## 6. "Promise to pay without a valid date" still schedules a follow-up call

**Choice:** If `insights.outcome` is "Accepted full payment later" but `paymentDate` is
missing or in the past, we **skip the payment_reminder** but **still schedule the
follow-up call** after `promiseFollowupDelayDays`.

**Why:** the human committed; that's the strongest signal. Not knowing the date doesn't
invalidate the commitment.

**Given up:** the schedule precision. The follow-up call uses the default delay rather
than a date-derived target.

## 7. Audit log in English, plain text

**Choice:** every audit line is a short English sentence. No i18n, no structured JSON.

**Why:** reviewer-readability beats production-readiness in a take-home.

**Given up:** programmatic post-processing (`grep -F "classify:"` works fine, but a
structured emit would be nicer for log aggregators).

## 8. Tool event deduplication strategy

**Choice:** dedupe by `id` when present, else by `(name, status, createdAt)`. Different
`name` values are **never** treated as duplicates (e.g. `send_payment_link` and
`send_payment_plan_link` count as two distinct events).

**Why:** the producer (telephony, agent, Stripe) is the authority on identity. We honor
the `id` when given. Composite-key dedup is a safety net for webhook retries.

**Given up:** stronger semantic dedup (e.g. recognizing that two distinct names mean
"some payment link was sent"). Operator-side reconciliation can handle this if needed.

## 9. Summary truncation cap at 2000 chars

**Choice:** `callPatch.summary` is truncated to 2000 chars with a trailing `…` if
longer.

**Why:** transcript dumps in production can be megabytes. Output payloads should not
balloon downstream storage.

**Given up:** information past 2000 chars. The full summary should be persisted by the
caller (transcript service), not by this engine's output.

## 10. Audit-log sanitization

**Choice:** strip ASCII C0 controls (`\r`, `\n`, `\t`, ...) from tool event `name` and
`createdAt` before embedding them in audit/warnings.

**Why:** if the audit log is ever joined by `\n` and shipped to a log aggregator, an
embedded newline could fabricate fake entries. Defense in depth.

**Given up:** literal newline preservation in tool names (which never legitimately
contain newlines anyway).

## 11. "now" injected as input

**Choice:** every function takes `now` as a string argument; no clock reads anywhere
in `src/`.

**Why:** deterministic. Same input → same output. Trivially testable.

**Given up:** ergonomics — callers must remember to pass `now`. Worth it.

## 12. TypeScript strict + `noUncheckedIndexedAccess`

**Choice:** `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`.

**Why:** strict typing limits the surface area where AI-generated code can hide bugs.
Indexed access returning `undefined` forces explicit handling.

**Given up:** some ergonomics (`array[0]` returns `T | undefined`, not `T`). The
cleanest is to use `.at(0)` or to handle the undefined explicitly. Worth it.

## 13. `string & {}` for extensible string unions

**Choice:** `CallStatus` and `AmdStatus` are declared as union literals plus
`(string & {})` so that "unknown values are typeable but autocomplete still suggests
the known ones".

**Why:** the sujet says these fields are `string` — we don't want to reject unknown
values. We also want the well-known values to surface in IDE autocomplete.

**Given up:** stricter type narrowing on unknown values. Could be replaced by a closed
union + a fallback case, at the cost of refactoring callers.
