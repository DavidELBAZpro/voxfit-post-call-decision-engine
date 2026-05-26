import type { PostCallInput, ToolEvent } from "../src/types.js";

export const baseInput = (overrides: Partial<PostCallInput> = {}): PostCallInput => ({
  now: "2025-03-15T14:00:00.000Z",
  timezone: "Europe/Paris",
  call: {
    callSid: "CA123",
    status: "completed",
    amdStatus: "human",
    durationSec: 60,
    performedAt: "2025-03-15T13:59:00.000Z",
  },
  case: {
    caseId: "case-1",
    status: "active",
    amountRemaining: 250,
    currency: "EUR",
  },
  step: {
    stepActionId: "step-1",
    maxAttempts: 5,
    attemptsSoFar: 0,
    retryDelayHours: 24,
    promiseFollowupDelayDays: 1,
  },
  insights: {},
  toolEvents: [],
  ...overrides,
});

export const withInsights = (
  input: PostCallInput,
  insights: PostCallInput["insights"],
): PostCallInput => ({ ...input, insights: { ...input.insights, ...insights } });

export const withCall = (
  input: PostCallInput,
  call: Partial<PostCallInput["call"]>,
): PostCallInput => ({ ...input, call: { ...input.call, ...call } });

export const withTools = (input: PostCallInput, toolEvents: ToolEvent[]): PostCallInput => ({
  ...input,
  toolEvents,
});
