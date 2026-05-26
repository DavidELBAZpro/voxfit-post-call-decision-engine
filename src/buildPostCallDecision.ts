import { classify } from "./classify.js";
import { planActions } from "./planActions.js";
import type { PostCallDecision, PostCallInput } from "./types.js";
import { validateInput } from "./validate.js";

export const buildPostCallDecision = (input: PostCallInput): PostCallDecision => {
  const validation = validateInput(input);
  const classification = classify(input);
  const plan = planActions({ outcome: classification.outcome, input });

  return {
    normalizedOutcome: classification.outcome,
    casePatch: plan.casePatch,
    scheduledActions: plan.scheduledActions,
    callPatch: plan.callPatch,
    warnings: [...validation.warnings, ...plan.warnings],
    auditLog: [...validation.audit, ...classification.audit, ...plan.audit],
  };
};
