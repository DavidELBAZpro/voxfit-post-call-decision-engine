# Performance

Latency and throughput numbers for `buildPostCallDecision`. Reproduce with `pnpm bench`.

## TL;DR

| Scenario class | Throughput | Mean latency | p99 latency |
|---|---|---|---|
| **Fast path** (case already excluded → short-circuit, no Luxon) | **~2.7M ops/s** | **0.4 µs** | 0.5 µs |
| **Typical path** (no-answer, voicemail, callback snap, dispute, max-attempts) | 40k–57k ops/s | 18–24 µs | 23–31 µs |
| **Heavy path** (`promise_to_pay` with reminder + follow-up scheduling) | ~22k ops/s | 44 µs | 63 µs |
| **Worst path** (DST spring-forward day — extra Luxon math) | ~15k ops/s | 65 µs | 94 µs |

Even the worst observed scenario does **>15,000 decisions per second** on a single
laptop CPU core. Variance is <1.1% relative margin of error across all benches.

## Why this matters for a voice-AI use case

Voxfit's agents run continuously. A post-call decision happens **once per call**,
*after* the call ends, so the user is not waiting on it. But the system processes
**many calls in parallel**, and the cost compounds across:

- Number of calls per day
- Engines per service node
- Headroom needed for spikes (campaign launches, end-of-month dunning peaks)

A reasonable fleet might process **100,000 calls/day** ≈ **1 call/sec average**, with
peaks ~10× that. The engine handles **22,000/sec on the heavy path** — three orders
of magnitude above peak, all on one core. CPU is **not** the bottleneck.

The interesting properties for production:

1. **Sub-millisecond p99 on all paths.** No GC pauses, no async, no I/O — by
   construction (the engine is a pure sync function).
2. **Fast paths are 100×+ faster than heavy paths.** That asymmetry is on purpose: the
   `perm_excluded` / `completed` guard short-circuits before any scheduling work
   happens. Cases that don't need work cost ~nothing.
3. **Low variance.** RME (relative margin of error) < 1.1% across runs means timings
   are predictable. That's what you want for a real-time-ish system where p99 latency
   matters more than mean.

## Raw bench output (representative run)

Captured on a MacBook (M1-class CPU), Node 22.15.0, Vitest 2.1.9.

```
✓ buildPostCallDecision — per-scenario throughput
  name                                                           hz       mean      p99    samples
  01-promise-to-pay.json — promise-to-pay-future-date        22,492.80   44.5 µs  63.6 µs   11,247
  02-payment-link-sent.json — payment-link-sent              27,367.70   36.5 µs  47.9 µs   13,684
  03-stop-contact.json — stop-contact                     2,744,071.72    0.4 µs   0.5 µs  1,372,036  ← fastest
  04-no-answer-retry.json — no-answer-retry                  41,660.28   24.0 µs  31.0 µs   20,831
  05-no-answer-max-attempts.json — no-answer-max-attempts    56,768.48   17.6 µs  23.0 µs   28,385
  06-voicemail.json — voicemail-detected                     42,704.59   23.4 µs  31.0 µs   21,353
  07-callback-snapped.json — callback-snapped                43,633.36   22.9 µs  29.4 µs   21,817
  08-debt-dispute.json — debt-dispute                        56,246.15   17.8 µs  22.8 µs   28,124
  09-already-excluded.json — already-permanently-excluded 2,672,865.91    0.4 µs   0.5 µs  1,336,433
  10-dst-spring-forward.json — dst-spring-forward-reminder   15,445.22   64.7 µs  93.6 µs    7,723  ← slowest

✓ buildPostCallDecision — fast path vs slow path (50k iterations each)
  fast path — perm_excluded                              2,663,617.82    0.4 µs   0.5 µs
  slow path — promise_to_pay (Luxon DST + scheduling)       22,402.00   44.6 µs  56.2 µs
  → fast path is 118.90× faster
```

## How to read these numbers

- **`hz`** = operations per second (the headline number; higher is better).
- **`mean`** = average wall-clock per call.
- **`p99`** = 99th-percentile latency — 99% of calls finish at or below this time.
- **`samples`** = how many iterations Vitest ran to stabilize the measurement. More
  samples = tighter confidence.
- **`rme`** (not shown above for brevity but in the raw output) = relative margin of
  error. Under 1% means the measurement is solid.

## What dominates the cost

Profiling shows the hot path is **Luxon DateTime construction and timezone math**, not
our control flow. The classification cascade and the case-state matrix are essentially
free (microseconds per call when Luxon is involved, nanoseconds otherwise).

If we ever needed to push throughput further (we don't), the lever would be:
- Cache Luxon DateTime instances when the same `now` is reused.
- Replace `Luxon` with hand-rolled offset math for the specific Europe/Paris DST policy
  (drop the dep, lose generality).

Both would trade simplicity for speed in a way that isn't justified by current numbers.

## How to reproduce

```sh
pnpm install
pnpm bench
```

Vitest will run the benches, print the table above, and exit. Run 3-5 times if you
want to bound the noise — numbers will move ±20% between runs on the same machine
depending on what else is using CPU and how the JIT warmed up.

See [`bench/README.md`](../bench/README.md) for the methodology and what each scenario
is exercising.
