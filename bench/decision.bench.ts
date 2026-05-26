import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";
import { buildPostCallDecision } from "../src/buildPostCallDecision.js";
import type { PostCallInput } from "../src/types.js";

type ScenarioFile = { name: string; description: string; input: PostCallInput };

const SCENARIOS_DIR = fileURLToPath(new URL("../scenarios/", import.meta.url));
const scenarios = readdirSync(SCENARIOS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({
    file: f,
    ...(JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf-8")) as ScenarioFile),
  }));

describe("buildPostCallDecision — per-scenario throughput", () => {
  for (const scenario of scenarios) {
    bench(`${scenario.file} — ${scenario.name}`, () => {
      buildPostCallDecision(scenario.input);
    });
  }
});

describe("buildPostCallDecision — fast path vs slow path", () => {
  const fastPath = scenarios.find((s) => s.file === "03-stop-contact.json");
  const slowPath = scenarios.find((s) => s.file === "01-promise-to-pay.json");

  if (fastPath) {
    bench(
      "fast path — perm_excluded (no scheduling, no Luxon)",
      () => {
        buildPostCallDecision(fastPath.input);
      },
      { iterations: 50_000 },
    );
  }

  if (slowPath) {
    bench(
      "slow path — promise_to_pay (Luxon DST + scheduling + reminder + follow-up)",
      () => {
        buildPostCallDecision(slowPath.input);
      },
      { iterations: 50_000 },
    );
  }
});
