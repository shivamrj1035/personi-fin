/** Monthly bandwidth and multi-debt payoff strategies. */
import { ISODate, addMonths, today as todayIso } from "./dates";
import { round } from "./loans";

export interface Debt {
  id: string; name: string; balance: number; rate: number; min_payment: number; kind: string; deadline: ISODate | null;
}
export interface Bandwidth { income: number; expenses: number; dues: number; surplus: number; buffer: number; spare: number }
export type Strategy = "avalanche" | "snowball" | "deadline";
export interface SimResult {
  strategy: Strategy; months: number | null; total_interest: number; payoff_month: Record<string, number>;
  timeline: number[]; debt_free_date: ISODate | null;
}

export function monthlyBandwidth(income: number, expenses: number, dues: number, buffer = 0): Bandwidth {
  const surplus = income - expenses - dues;
  return { income, expenses, dues, surplus, buffer, spare: Math.max(surplus - buffer, 0) };
}

function order(debts: Debt[], strategy: Strategy): Debt[] {
  const live = debts.filter((d) => d.balance > 0.005);
  const dl = (d: Debt) => d.deadline ?? "9999-12-31";
  if (strategy === "avalanche") return live.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
  if (strategy === "snowball") return live.sort((a, b) => a.balance - b.balance);
  return live.sort((a, b) => (dl(a) < dl(b) ? -1 : dl(a) > dl(b) ? 1 : 0) || b.rate - a.rate);
}

/** Pay every minimum, then pour the rest of `monthlyBudget` into the target debt; freed minimums roll over. */
export function simulate(debts: Debt[], monthlyBudget: number, strategy: Strategy, start?: ISODate, maxMonths = 600): SimResult {
  start = start ?? todayIso();
  const ds = debts.map((d) => ({ ...d }));
  let totalInterest = 0, month = 0;
  const payoff: Record<string, number> = {};
  const timeline = [Math.round(ds.reduce((s, d) => s + d.balance, 0))];
  while (ds.some((d) => d.balance > 0.005) && month < maxMonths) {
    month++;
    for (const d of ds) if (d.balance > 0.005) { const i = (d.balance * d.rate) / 1200; d.balance += i; totalInterest += i; }
    let pool = monthlyBudget;
    for (const d of ds) if (d.balance > 0.005) { const pay = Math.min(d.min_payment, d.balance, pool); d.balance -= pay; pool -= pay; }
    for (const d of order(ds, strategy)) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.balance); d.balance -= pay; pool -= pay;
    }
    for (const d of ds) if (d.balance <= 0.005 && !(d.id in payoff)) { payoff[d.id] = month; d.balance = 0; }
    timeline.push(Math.round(ds.reduce((s, d) => s + d.balance, 0)));
  }
  const done = ds.every((d) => d.balance <= 0.005);
  return { strategy, months: done ? month : null, total_interest: round(totalInterest, 2), payoff_month: payoff, timeline,
    debt_free_date: done ? addMonths(start, month) : null };
}

export function compareStrategies(debts: Debt[], extraPerMonth: number): SimResult[] {
  const budget = debts.filter((d) => d.balance > 0).reduce((s, d) => s + d.min_payment, 0) + extraPerMonth;
  return (["avalanche", "snowball", "deadline"] as Strategy[]).map((s) => simulate(debts, budget, s));
}
