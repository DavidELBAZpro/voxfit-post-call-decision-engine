import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPostCallDecision } from "../src/buildPostCallDecision.js";
import type { PostCallDecision, PostCallInput } from "../src/types.js";

type Scenario = {
  name: string;
  description: string;
  input: PostCallInput;
  expected: Partial<PostCallDecision>;
};

const SCENARIOS_DIR = fileURLToPath(new URL("../scenarios/", import.meta.url));

const scenarioFiles = readdirSync(SCENARIOS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("scenarios — end-to-end JSON fixtures", () => {
  for (const file of scenarioFiles) {
    const scenario = JSON.parse(
      readFileSync(join(SCENARIOS_DIR, file), "utf-8"),
    ) as Scenario;

    it(`${file} — ${scenario.description}`, () => {
      const result = buildPostCallDecision(scenario.input);
      expect(result).toMatchObject(scenario.expected);
    });
  }
});
