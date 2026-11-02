/** Loan maths: EMI, amortisation, rate solving, prepayment effects. */
import { ISODate, addMonths, daysInMonth, firstOfMonth, lastWorkingDay, parts } from "./dates";

export const LOAN_TYPES: Record<string, string> = {
  bank_emi: "Bank / NBFC EMI loan",
  interest_only: "Pay only interest until principal is cleared",
  interest_free_deadline: "Interest-free, has a deadline",
  interest_free_flexible: "Interest-free, no deadline",
  fixed_monthly: "Fixed monthly amount to a known person",
  bullet: "Gold loan: interest every month, principal at the end",
};

export interface ScheduleRow {
  inst_no: number; due_date: ISODate | null; opening: number; principal: number; interest: number; emi: number; closing: number;
}

export function emi(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) throw new Error("months must be positive");
  const r = annualRatePct / 1200;
  if (r === 0) return principal / months;
  return (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
}

/** Annual rate (%) that makes `months` payments of `payment` repay `principal` (0 when interest-free). */
export function solveRate(principal: number, payment: number, months: number): number {
  if (payment * months <= principal * 1.0005) return 0;
  let lo = 0, hi = 100;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (emi(principal, mid, months) > payment) hi = mid; else lo = mid;
  }
  return round((lo + hi) / 2, 3);
}

export function monthsToClear(balance: number, annualRatePct: number, payment: number): number | null {
  const r = annualRatePct / 1200;
  if (balance <= 0) return 0;
  if (payment <= balance * r + 1e-9) return null;
  let n = 0;
  while (balance > 0.005 && n < 1200) { balance = balance * (1 + r) - payment; n++; }
  return n;
}

export function schedule(principal: number, annualRatePct: number, payment: number, months: number, firstDue: ISODate): ScheduleRow[] {
  const r = annualRatePct / 1200;
  const rows: ScheduleRow[] = [];
  let bal = principal;
  for (let i = 1; i <= months; i++) {
    const interest = bal * r;
    const pay = Math.min(payment, bal + interest);
    const prin = pay - interest;
    const close = Math.max(bal - prin, 0);
    rows.push({ inst_no: i, due_date: addMonths(firstDue, i - 1), opening: round(bal, 2), principal: round(prin, 2),
      interest: round(interest, 2), emi: round(pay, 2), closing: round(close, 2) });
    bal = close;
    if (bal <= 0.005) break;
  }
  return rows;
}

/** How many instalments have fallen due by `today` (assumed paid). */
export function installmentsDue(firstDue: ISODate, today: ISODate, total: number): number {
  if (today < firstDue) return 0;
  const a = parts(firstDue), b = parts(today);
  let n = (b.y - a.y) * 12 + b.m - a.m;
  if (b.d >= a.d) n += 1;
  return Math.max(0, Math.min(n, total));
}

export interface PrepaymentResult { months_saved: number; interest_saved: number; new_months: number | null; new_emi: number | null }

/** One-time part-prepayment that reduces principal. keepEmi: same EMI, shorter tenure; else same tenure, lower EMI. */
export function prepaymentEffect(balance: number, rate: number, payment: number, extra: number, keepEmi = true): PrepaymentResult {
  const baseN = monthsToClear(balance, rate, payment);
  const baseInterest = baseN ? baseN * payment - balance : 0;
  const newBal = Math.max(balance - extra, 0);
  if (keepEmi) {
    const n = monthsToClear(newBal, rate, payment) || 0;
    const interest = n ? n * payment - newBal : 0;
    return { months_saved: (baseN || 0) - n, interest_saved: Math.max(baseInterest - interest, 0), new_months: n, new_emi: payment };
  }
  const newEmi = baseN && newBal > 0 ? emi(newBal, rate, baseN) : 0;
  const interest = baseN ? newEmi * baseN - newBal : 0;
  return { months_saved: 0, interest_saved: Math.max(baseInterest - interest, 0), new_months: baseN, new_emi: newEmi };
}

export const interestForDays = (balance: number, ratePct: number, days: number): number => (balance * ratePct) / 100 * days / 365;

/** What falls due in `month` on a loan with monthly interest and principal on `due`: [label, date, amount, principalPart]. */
export function bulletMonthItems(balance: number, rate: number, month: ISODate, due: ISODate): [string, ISODate, number, number][] {
  const first = firstOfMonth(month), dueFirst = firstOfMonth(due);
  if (first < dueFirst) {
    return [[`Interest (${daysInMonth(first)} days)`, lastWorkingDay(first), round(interestForDays(balance, rate, daysInMonth(first)), 2), 0]];
  }
  if (first === dueFirst) {
    return [[`Final interest (${parts(due).d} days)`, due, round(interestForDays(balance, rate, parts(due).d), 2), 0],
      ["Repay principal", due, round(balance, 2), round(balance, 2)]];
  }
  return [];
}

/** Python-style round-half-even is not needed; this matches round() for the money values used here. */
export function round(x: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
}
