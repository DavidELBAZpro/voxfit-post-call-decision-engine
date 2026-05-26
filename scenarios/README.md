# Scenarios

Each `.json` file is a self-contained end-to-end scenario:

```json
{
  "name": "human-readable name",
  "description": "what this scenario exercises",
  "input": { /* full PostCallInput */ },
  "expected": { /* the fields of PostCallDecision this scenario cares about */ }
}
```

Run them with `pnpm test scenarios` (they're picked up by `tests/scenarios.test.ts`).

Add a new scenario by dropping a new `.json` file here — no test code change needed.

The 10 included scenarios collectively touch every normalized outcome:

| # | File | Outcome | What it shows |
|---|---|---|---|
| 01 | `promise-to-pay.json` | `promise_to_pay` | Reminder on promise date + follow-up call |
| 02 | `payment-link-sent.json` | `wait_payment_confirmation` | Tool event drives outcome, `paymentLinkSent: true` |
| 03 | `stop-contact.json` | `do_not_call` | Permanent exclusion, no scheduled actions |
| 04 | `no-answer-retry.json` | `no_answer` | Retry call after `retryDelayHours` |
| 05 | `no-answer-max-attempts.json` | `no_answer` | Max attempts reached → `manual_review` + warning |
| 06 | `voicemail.json` | `voice_mail` | AMD detects machine, retry scheduled |
| 07 | `callback-snapped.json` | `callback_scheduled` | Callback time snapped to next valid window slot |
| 08 | `debt-dispute.json` | `disputed` | Manual review scheduled |
| 09 | `already-excluded.json` | (any) | Case `perm_excluded` → no-op + warning |
| 10 | `dst-spring-forward.json` | `promise_to_pay` | Payment reminder on 2025-03-30 → `07:00Z` (CEST) |
