# Question Dispatcher

This file is the **routing logic** for a Claude Code orchestrator landing on this repo.
When a question comes in, match it to a category below and delegate to the corresponding
subagent in `.claude/agents/`. Do not answer directly without dispatch — that's the whole
point.

## Routing matrix

| Question shape | Trigger words | Subagent | Time budget |
|---|---|---|---|
| Run / install / test / build | "run", "install", "command", "script", "Node version" | `runtime-helper` | 30s |
| Locate / read / explain code | "where", "what does X do", "show me", "find" | `code-explorer` | 1-2 min |
| Why was X chosen / rationale / tradeoff | "why", "rationale", "tradeoff", "design choice" | `arch-explainer` | 1-3 min |
| Add / extend / modify a feature | "add", "support", "extend", "how would I" | `feature-extender` | 3-10 min (plan only) |
| Audit / verify / does the code match | "is X correct", "does Y hold", "audit", "verify against sujet" | `rules-reviewer` | 3-10 min |

If the question doesn't cleanly fit one row, **start with `code-explorer` to ground
yourself**, then escalate.

## Example dispatch — 5 questions, simple → pointed

### Q1 (simple, ~30s)
> "How do I run the tests on this repo?"

- **Dispatch:** `runtime-helper`
- **Reads:** `README.md`, `package.json`
- **Expected answer:** `pnpm install && pnpm test` (cite README:L20).

### Q2 (lookup, ~1 min)
> "What does the engine return when `call.status` is `no-answer` and there's also a
> transcript outcome `Accepted full payment later`?"

- **Dispatch:** `code-explorer`
- **Reads:** `src/classify.ts` (the cascade), `tests/classify.test.ts` (the conflict
  test). Bonus: cross-check `tests/edge-cases.test.ts`.
- **Expected answer:** `normalizedOutcome: "no_answer"` because telephony safety
  overrides AI insights. (Cite `src/classify.ts:39-44`.) Audit log records both the
  telephony match and the *non*-classification of the insight.

### Q3 (rationale, ~2 min)
> "Why did you pick Luxon over date-fns or native Date?"

- **Dispatch:** `arch-explainer`
- **Reads:** `docs/design.md` §4, `AI_USAGE.md` §2.2.
- **Expected answer:** Native `Date` has no concept of named zones — only offsets — so a
  rule like "09:00 Paris time on a date" is provably wrong on DST days. `date-fns-tz`
  works but Luxon's IANA-aware API is cleaner for this domain. The 20kB cost is
  acceptable. Cite `docs/design.md §4`.

### Q4 (pointed, ~5-10 min plan)
> "I want to add a new outcome `callback_no_show` for cases where the user scheduled a
> callback but didn't pick up. What files change and in what order?"

- **Dispatch:** `feature-extender`
- **Reads:** `src/types.ts`, `src/classify.ts`, `src/planActions.ts`, `docs/business-rules.md`,
  `tests/classify.test.ts`, `tests/planActions.test.ts`.
- **Expected answer (file-by-file plan):**

  | File | Change | Why |
  |---|---|---|
  | `src/types.ts` | Add `"callback_no_show"` to `NormalizedOutcome` union | New outcome must be in the type contract. |
  | `src/classify.ts` | New cascade entry: `attemptsSoFar > 0 && previous outcome was callback_scheduled && status no-answer` → `callback_no_show` | Detects pattern. Needs access to *previous* call's context — may require extending `PostCallInput.step`. |
  | `src/planActions.ts` | New `handleCallbackNoShow` — escalate after N retries, otherwise reschedule with longer delay | Distinct case-state effect from plain `no_answer`. |
  | `docs/business-rules.md` | New R15 entry, tagged with the new tests | Single source of truth. |
  | `tests/classify.test.ts` | RED test for the new cascade entry | TDD discipline. |
  | `tests/planActions.test.ts` | RED tests for the handler — retry vs escalation | TDD discipline. |

  Order: types → tests RED → cascade entry → tests still RED on planActions → handler →
  GREEN. Doc update in the same commit.

### Q5 (most pointed, ~5-10 min audit)
> "Is the cascade order in `src/classify.ts` actually correct given the business intent
> in §1 of the sujet (Telephony Safety Overrides)?"

- **Dispatch:** `rules-reviewer`
- **Reads (side by side):**
  - Sujet `/Users/davidelbaz/Downloads/ai-assisted-take-home.md` §1.
  - `docs/business-rules.md` R1 + R2.
  - `src/classify.ts` lines 33-46.
  - `tests/classify.test.ts` (telephony block + conflict tests).
  - `tests/edge-cases.test.ts` (conflicting signals).
- **Expected finding format:**

  ```
  ## R1: Telephony safety overrides
  
  Sujet §1: "If amdStatus indicates machine or voicemail, classify as voice_mail.
             If status is no-answer/busy/failed, classify as no_answer."
  
  Implementation: src/classify.ts:35-46 — checks amdStatus first, then status.
                  Both branches short-circuit before any insight check.
  
  Test:           tests/classify.test.ts:32-40 — verifies the cascade for the conflict
                  case (transcript says promise_to_pay, status=no-answer → no_answer wins).
  
  Verdict:        match.
  ```

## Hard rules for the orchestrator

1. **Never answer without dispatching.** Even simple questions go through `runtime-helper`
   — the dispatch overhead is ~5 lines and the consistency is worth it.
2. **The dispatcher decides; the subagent answers.** Don't second-guess the subagent's
   output (other than to flag obvious factual errors).
3. **If two subagents could apply, pick the more specific one.** "Why is `Luxon`
   used" → `arch-explainer` (rationale) beats `code-explorer` (just shows the import).
4. **Subagents are read-only by default.** Only `feature-extender` can propose changes
   (and even then, only as a plan — the user approves before edits).
