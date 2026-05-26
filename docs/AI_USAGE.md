# How I Work With AI

This is not a defense against "did AI write this for you" suspicion. It's a description
of **how I work as an engineer in the AI era**, of which this take-home is one
concrete example.

If you only have a minute, read §1 and §3.

## §1 — The mental model: AI as a permanent companion

I treat AI as a top-tier collaborator who sits next to me all day. Not a tool I reach
for when stuck — a colleague who's part of every meaningful decision. The relationship
is closer to pair programming with a strong partner than to autocomplete.

Two implications follow from this.

## §2 — Execution got cheaper, so brainstorming got longer

The hard time investment in software used to be **implementation**. That bottleneck is
largely gone — AI writes code at a speed no human matches. So where should the saved
hours go?

**Upstream.** I deliberately spend *more* time brainstorming than I would have alone,
not less. Concretely:

- I explore 3-4 alternative architectures with the AI in 20 minutes. Alone, I'd have
  committed to my first decent idea.
- I push the AI to argue **against its own first proposal**. Most of the time it has
  better second thoughts than first instincts.
- I surface edge cases by asking "what's the weirdest input that could break this?" —
  cases that used to only emerge during implementation, now show up before any code
  is written.
- I sit with **tradeoffs explicitly** instead of glossing over them. Every choice now
  has a documented rationale because the cost of writing it down has dropped.

The result is code I trust more, written faster, with documentation that reflects what
actually happened during the design phase. The total time is shorter; the quality is
higher.

## §3 — What hasn't changed: classical software engineering fundamentals

AI doesn't replace these. It **amplifies them**. Skip these and the AI's mistakes
compound. Honor them and the AI's speed compounds your judgment.

### 3.1 Good design choices

Right architecture, right separation of concerns, right abstractions. AI is excellent at
**implementing** a good design and merely competent at **proposing** one. The design
is mine to own.

### 3.2 Maximum typing on every function

This is the **single biggest underestimated lever** in the AI era. Every function
signature, every domain value, every union — the more your type system constrains the
space of valid code, the less room the AI has to hallucinate.

When the AI sees `(x: any) => any`, the choice space is infinite. When it sees
`(x: PostCallInput) => Classification`, the space collapses to "what makes type sense
for these inputs and that output". The AI either writes correct code, or it asks. It
doesn't invent.

This is why on this repo:
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- Every exported function has explicit parameter and return types.
- Domain values (outcomes, status, weekdays) are strict unions, not strings.
- There is **zero `any`** in `src/`. Zero `!` non-null assertions.

That's not pedantry. That's leverage against hallucination.

### 3.3 Test-driven development

TDD was always the right discipline. The bottleneck was always "writing tests takes
time". That bottleneck is gone.

The new cycle with AI:

1. I describe a behavior, in my words, no code.
2. AI writes the failing test.
3. **I read the test carefully.** This is the critical human step — does the test
   capture what I actually want, not just what's easy to implement?
4. Watch RED. (If it doesn't, my mental model and the AI's are out of sync — that's
   a signal to slow down, not speed up.)
5. AI writes minimal implementation.
6. Watch GREEN. Commit.

Each cycle is minutes. Each commit is a verified increment. The output: code that does
exactly what I asked for, no more, no less, with a test that proves it.

## §4 — My workflow on any new project

### Phase A — Brainstorm (long)
Sit with the AI. Explore architecture, dep choices, layer boundaries, edge cases. Push
back on first instincts. Make it argue both sides. End with a written design I sign off
on.

### Phase B — Bootstrap (homemade skill)
Once decisions are made, I trigger a custom skill (built up over months) that:
- Creates the project structure with idiomatic conventions.
- Writes a focused `CLAUDE.md` with the hard rules for this project (e.g. "no clock
  reads in `src/`", "every branch drops one audit line").
- Sets up specialized subagents matched to the project's domains (code-explorer,
  arch-explainer, feature-extender, rules-reviewer).
- Builds a dispatcher so future AI sessions on this code route questions to the right
  agent.

The output: a repo where any AI session has the maximum context to be useful. Cost paid
once; benefit compounds forever.

(For this take-home, the heavy bootstrap lives on the `dev-meta` branch to keep `main`
focused on the deliverable a reviewer expects.)

### Phase C — TDD execution
Module by module: tests RED → implementation GREEN → commit. The AI is fast; my job
is to read each test before letting implementation through.

### Phase D — Documentation, sealed by the human
At each meaningful decision point I write a paragraph explaining *why* — not what the
code does (that's evident from reading) but the constraint or insight that drove the
choice. This is the document I'd want six months later.

## §5 — What I watch for (and what the AI gets wrong)

These are predictable AI failure modes. Vigilance against them is what makes the
collaboration work.

- **First proposals are usually monoliths.** AI defaults to all-in-one functions.
  Push for separation.
- **Convenience over correctness.** AI happily calls `Date.now()` for "ergonomics" —
  breaking determinism. Reject.
- **Regex bugs.** A regex that "looks right" often isn't. Read every character class.
  (I caught this on this project — see §6.3.)
- **Time-zone arithmetic.** AI is consistently wrong on DST. Verify with real boundary
  dates.
- **Signed math.** Negative inputs, zero, `NaN` — AI doesn't think about them by
  default. Write the tests yourself.
- **Lost determinism.** AI sometimes "improves" code by removing arguments that look
  unused — like `now`. Determinism dies silently.

## §6 — Concrete moments on this project where I disagreed with the AI

Same content as the previous version of this file. Kept for the reviewer who wants the
ground-truth examples.

### 6.1 Architecture
AI's first proposal was a monolithic `buildPostCallDecision`. I rejected it for the
three-layer pipeline because each layer represents a real domain concept (call's
meaning, time math, case state).

### 6.2 Date library
AI initially suggested no dep (native `Date`). I pushed for Luxon — the sujet
explicitly calls out DST and `Europe/Paris`; `Date` has no IANA zone awareness.

### 6.3 Sanitize regex
AI's first regex was `/[\r\n\t -]+/g` — the `-` becomes a literal that would also strip
legitimate dashes from words like `wait_payment_confirmation`. I caught it before commit.
Corrected to `/[\r\n\t\x00-\x1f]+/g`.

### 6.4 Determinism
AI's first scheduling helper called `DateTime.now()` internally. I rejected — every
test would have been non-deterministic.

### 6.5 A test that lied to itself
A draft test used `NOW_SUMMER = "2025-06-15..."` with a payment date in April — past
relative to "now". The test expected a runAt before now, contradicting the engine's
"never schedule in the past" rule. The test was wrong, not the implementation.

## §7 — What I'd never delegate

- The architecture decisions.
- The dep choices.
- The choice of **what to test** (and what NOT to test — out-of-scope cases matter).
- Reading each test before letting implementation through.
- The pushback when the AI's first instinct is wrong.
- The decision of what's "good enough" for a given timebox.

## §8 — This take-home, measured against this methodology

- **Brainstorm:** ~30 min. Architecture, dep choice, cascade order, layer boundaries.
  Documented in `docs/design.md`.
- **Bootstrap:** ~5 min. `CLAUDE.md`, project structure, pnpm setup. (Full skill on
  `dev-meta` branch.)
- **TDD execution:** ~1h. Six modules: types → classify → scheduling → planActions →
  orchestrator → edge-cases. RED before GREEN, every time. Visible in commit history.
- **Documentation pass:** ~20 min. `business-rules.md`, `edge-cases.md`, `tradeoffs.md`,
  `limitations.md`, this file.
- **Extra brainstorm + 17 more edge cases:** ~30 min. Catching things the sujet didn't
  list (negative durations, future timestamps, control chars in audit, transcript
  truncation, midnight-crossing windows).

Each phase shorter than alone. Total shorter. Quality higher. That's the bet.

---

*If you want to see the full development tooling — the homemade skill output with five
specialized subagents and a dispatcher — switch to the `dev-meta` branch.*
