# Benchmarks

Latency / throughput measurement for `buildPostCallDecision`. Uses Vitest's native
`bench` runner (no extra dep).

## Run

```sh
pnpm bench
```

Vitest prints a table per `describe` block with **ops/sec**, **mean latency**, **p99
latency**, and **median**. Higher ops/sec = better.

## What we measure

Two perspectives, both using the **real production code path** (no mocks, no stubs):

### 1. Per-scenario throughput

One `bench()` per [`scenarios/*.json`](../scenarios/) fixture (10 scenarios). Each
scenario exercises a different code path:

- `01-promise-to-pay.json` → most work: classify + Luxon scheduling + reminder + follow-up
- `02-payment-link-sent.json` → tool event dedup + Luxon scheduling
- `03-stop-contact.json` → **fast path**: perm_excluded short-circuits all scheduling
- `04-no-answer-retry.json` → classify + Luxon delayed call
- `05-no-answer-max-attempts.json` → classify + Luxon manual_review
- `06-voicemail.json` → telephony override + Luxon delayed call
- `07-callback-snapped.json` → classify + Luxon snap + warning
- `08-debt-dispute.json` → classify + Luxon manual_review
- `09-already-excluded.json` → **fastest path**: case-state guard, no Luxon at all
- `10-dst-spring-forward.json` → DST boundary day (CEST start) — Luxon DST math

The dispersion across these scenarios is the headline metric: it shows how *consistent*
the engine is across the input distribution.

### 2. Fast path vs slow path

Two focused benches with 50k iterations each, comparing the cheapest possible call
(`perm_excluded` short-circuit, no scheduling, no Luxon) against the most expensive
(`promise_to_pay` with DST-aware reminder + follow-up). The ratio tells you the maximum
variance the engine produces.

## Why this matters for Voxfit

Voice agents run **continuously**. Even though a post-call decision happens *after* a
call (so the user isn't waiting for it), a fleet that processes thousands of calls
per hour needs the per-decision cost to be:

- **Low absolute latency** (< 1 ms is ideal — leaves headroom for I/O around it).
- **Low variance** — the slow path shouldn't be 100× the fast path (it's not — see
  results in [`docs/performance.md`](../docs/performance.md)).
- **Predictable** — no GC pauses, no async surprises. The engine is pure-sync; this
  property holds by construction.

## Methodology notes

- The engine has **no I/O** — measurements reflect pure compute (parse + arithmetic +
  object allocation).
- `now` is fixed per scenario (it's part of the input), so each iteration is doing the
  same work. Vitest's bench runs a warm-up phase first to stabilize the JIT.
- Numbers will vary by ~20% between runs on the same machine due to noise (other
  processes, thermal throttling). Run 3-5 times if you want a tighter picture.
- These benches are **excluded from `pnpm test`** — they only run with `pnpm bench`.
  Vitest matches `*.bench.ts` for the bench runner specifically.
