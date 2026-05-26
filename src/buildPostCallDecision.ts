import { classify } from "./classify.js";
import { planActions } from "./planActions.js";
import type { PostCallDecision, PostCallInput } from "./types.js";

export const buildPostCallDecision = (input: PostCallInput): PostCallDecision => {
  const classification = classify(input);
  const plan = planActions({ outcome: classification.outcome, input });

  return {
    normalizedOutcome: classification.outcome,
    casePatch: plan.casePatch,
    scheduledActions: plan.scheduledActions,
    callPatch: plan.callPatch,
    warnings: plan.warnings,
    auditLog: [...classification.audit, ...plan.audit],
  };
};
