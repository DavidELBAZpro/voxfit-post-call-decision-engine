export type Timezone = "Europe/Paris";

export type CallStatus = "completed" | "no-answer" | "busy" | "failed" | (string & {});

export type AmdStatus =
  | "human"
  | "machine_start"
  | "machine_end"
  | "unknown"
  | (string & {});

export type CaseStatus = "active" | "temp_excluded" | "perm_excluded" | "completed";

export type CallWindowSlot =
  | "8-10"
  | "10-12"
  | "12-14"
  | "14-16"
  | "16-18"
  | "18-20"
  | "any";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type StepCallWindow = {
  days: Weekday[];
  start: string;
  end: string;
};

export type ToolEvent = {
  id?: string;
  name: string;
  status: "success" | "failed";
  createdAt: string;
  result?: Record<string, unknown>;
};

export type PostCallInput = {
  now: string;
  timezone: Timezone;

  call: {
    callSid: string;
    status?: string;
    amdStatus?: string | null;
    durationSec?: number | null;
    performedAt: string;
  };

  case: {
    caseId: string;
    status: CaseStatus;
    amountRemaining: number;
    currency: string;
    preferredCallWindow?: CallWindowSlot;
  };

  step: {
    stepActionId: string;
    maxAttempts?: number;
    attemptsSoFar?: number;
    retryDelayHours?: number;
    callWindow?: StepCallWindow;
    promiseFollowupDelayDays?: number;
  };

  insights: {
    summary?: string;
    outcome?: string;
    paymentDate?: string | null;
    callbackAt?: string | null;
  };

  toolEvents?: ToolEvent[];
};

export type NormalizedOutcome =
  | "no_answer"
  | "voice_mail"
  | "early_termination"
  | "callback_scheduled"
  | "promise_to_pay"
  | "wait_payment_confirmation"
  | "disputed"
  | "wrong_contact"
  | "do_not_call"
  | "uncooperative"
  | "unknown";

export type ScheduledActionType = "call" | "payment_reminder" | "manual_review";

export type ScheduledAction = {
  type: ScheduledActionType;
  runAt: string;
  reason: string;
};

export type CasePatch = {
  status?: CaseStatus;
  temporaryExclusionReason?: string | null;
  permanentExclusionReason?: string | null;
  nextActionAt?: string | null;
  paymentPromiseDate?: string | null;
};

export type CallPatch = {
  outcome: string;
  summary?: string;
  paymentLinkSent?: boolean;
};

export type PostCallDecision = {
  normalizedOutcome: NormalizedOutcome;
  casePatch: CasePatch;
  scheduledActions: ScheduledAction[];
  callPatch: CallPatch;
  warnings: string[];
  auditLog: string[];
};

export type Classification = {
  outcome: NormalizedOutcome;
  audit: string[];
};
