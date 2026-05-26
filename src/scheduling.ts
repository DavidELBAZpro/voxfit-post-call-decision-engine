import { DateTime } from "luxon";
import type { CallWindowSlot, StepCallWindow, Weekday } from "./types.js";

const PARIS = "Europe/Paris";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);

type ResolvedWindow = {
  days: Set<number>;
  startMinutes: number;
  endMinutes: number;
};

const DEFAULT_WINDOW: ResolvedWindow = {
  days: DEFAULT_WORKDAYS,
  startMinutes: 8 * 60,
  endMinutes: 20 * 60,
};

const SLOT_TO_RANGE: Record<CallWindowSlot, readonly [number, number]> = {
  "8-10": [8 * 60, 10 * 60],
  "10-12": [10 * 60, 12 * 60],
  "12-14": [12 * 60, 14 * 60],
  "14-16": [14 * 60, 16 * 60],
  "16-18": [16 * 60, 18 * 60],
  "18-20": [18 * 60, 20 * 60],
  any: [8 * 60, 20 * 60],
};

const parseHHMM = (value: string): number => {
  const [hStr, mStr] = value.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
};

const resolveWindow = (
  stepWindow: StepCallWindow | undefined,
  preferred: CallWindowSlot | undefined,
): ResolvedWindow => {
  if (stepWindow) {
    const start = parseHHMM(stepWindow.start);
    const end = parseHHMM(stepWindow.end);
    if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return DEFAULT_WINDOW;
    return {
      days: new Set(stepWindow.days.map((d) => WEEKDAY_INDEX[d])),
      startMinutes: start,
      endMinutes: end,
    };
  }
  if (preferred) {
    const range = SLOT_TO_RANGE[preferred];
    return { days: DEFAULT_WORKDAYS, startMinutes: range[0], endMinutes: range[1] };
  }
  return DEFAULT_WINDOW;
};

const inWindow = (dt: DateTime, w: ResolvedWindow): boolean => {
  if (!w.days.has(dt.weekday)) return false;
  const minutes = dt.hour * 60 + dt.minute;
  return minutes >= w.startMinutes && minutes < w.endMinutes;
};

const setToWindowStart = (dt: DateTime, w: ResolvedWindow): DateTime =>
  dt.set({
    hour: Math.floor(w.startMinutes / 60),
    minute: w.startMinutes % 60,
    second: 0,
    millisecond: 0,
  });

const advanceToWindowStart = (dt: DateTime, w: ResolvedWindow): DateTime => {
  let cursor = dt;
  const minutes = cursor.hour * 60 + cursor.minute;
  if (w.days.has(cursor.weekday) && minutes < w.startMinutes) {
    return setToWindowStart(cursor, w);
  }
  for (let i = 0; i < 8; i++) {
    cursor = setToWindowStart(cursor.plus({ days: 1 }), w);
    if (w.days.has(cursor.weekday)) return cursor;
  }
  return cursor;
};

const isoUtc = (dt: DateTime): string => {
  const iso = dt.toUTC().toISO();
  if (iso === null) {
    throw new Error("Unexpected invalid DateTime when serializing to UTC ISO");
  }
  return iso;
};

const parseDateOnly = (input: string, zone: string): DateTime => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return DateTime.fromISO(`${input}T00:00:00`, { zone });
  }
  return DateTime.fromISO(input, { zone });
};

export const paymentReminderAt = (
  dateInput: string | null | undefined,
  nowIso: string,
): string | null => {
  if (typeof dateInput !== "string") return null;

  const parsed = parseDateOnly(dateInput, PARIS);
  if (!parsed.isValid) return null;

  const reminder = parsed
    .startOf("day")
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

  const now = DateTime.fromISO(nowIso, { zone: PARIS });
  if (reminder < now) return null;

  return isoUtc(reminder);
};

export const snapToCallWindow = (
  targetIso: string,
  step: { callWindow?: StepCallWindow },
  preferred: CallWindowSlot | undefined,
  nowIso: string,
): { runAt: string; adjusted: boolean } => {
  const window = resolveWindow(step.callWindow, preferred);
  const now = DateTime.fromISO(nowIso, { zone: PARIS });

  const target = DateTime.fromISO(targetIso, { zone: PARIS });
  const targetValid = target.isValid && target >= now;
  const wasOriginallyInWindow = targetValid && inWindow(target, window);

  let dt = targetValid ? target : now;
  if (!inWindow(dt, window)) {
    dt = advanceToWindowStart(dt, window);
  }
  if (dt < now) {
    dt = advanceToWindowStart(now, window);
  }

  return {
    runAt: isoUtc(dt),
    adjusted: !wasOriginallyInWindow,
  };
};

export const delayedCallAt = (
  nowIso: string,
  delayHours: number | undefined,
  step: { callWindow?: StepCallWindow },
  preferred: CallWindowSlot | undefined,
): { runAt: string; adjusted: boolean } => {
  const hours = typeof delayHours === "number" && delayHours > 0 ? delayHours : 24;
  const target = DateTime.fromISO(nowIso, { zone: PARIS }).plus({ hours });
  return snapToCallWindow(isoUtc(target), step, preferred, nowIso);
};

export const nextManualReviewAt = (
  nowIso: string,
  step: { callWindow?: StepCallWindow },
  preferred: CallWindowSlot | undefined,
): string => {
  const now = DateTime.fromISO(nowIso, { zone: PARIS });
  const window = resolveWindow(step.callWindow, preferred);

  let candidate = now
    .plus({ days: 1 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  while (!window.days.has(candidate.weekday)) {
    candidate = candidate.plus({ days: 1 });
  }
  return isoUtc(candidate);
};
