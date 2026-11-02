/** Typed view over the workbook (pure: runs in the browser and on the server). Mirrors core/service.py::State. */
import { ISODate, addMonths, diffDays, firstOfMonth, monthKey, monthsBetween, parseDate, today } from "./dates";
import { Debt } from "./planner";
import * as L from "./loans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface Tabs {
  Loans: Row[]; Schedule: Row[]; Payments: Row[]; Extras: Row[]; Income: Row[]; MonthItems: Row[];
  Recurring: Row[]; Expenses: Row[]; Goals: Row[]; Holdings: Row[]; SavingsLog: Row[]; Settings: Row[];
}

export function num(v: unknown, dflt = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : dflt;
  const s = String(v ?? "").replace(/,/g, "").replace(/₹/g, "").trim();
  if (!s) return dflt;
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
}

export const truthy = (v: unknown): boolean => ["TRUE", "1", "YES", "Y"].includes(String(v ?? "").trim().toUpperCase());
export const toDate = parseDate;

export interface PersonSummary { person: string; expected: number; received: number; loans: number; expenses: number; extra: number; paid: number; net: number }

export class State {
  settings: Record<string, string>;
  constructor(public tabs: Tabs) {
    this.settings = {};
    for (const r of tabs.Settings) if (!String(r.key).startsWith("_")) this.settings[String(r.key)] = r.value;
  }

  get loans(): Row[] { return this.tabs.Loans; }
  schedule(loanId: string): Row[] { return this.tabs.Schedule.filter((s) => s.loan_id === loanId); }

  /** Current balance: from the schedule if there is one, else stored value minus payments. */
  outstanding(loan: Row): number {
    const sch = this.schedule(loan.id);
    if (sch.length) {
      const unpaid = sch.filter((s) => !truthy(s.paid));
      // opening of the next unpaid instalment already reflects any part-prepayments
      return unpaid.length ? num(unpaid[0].opening) : 0;
    }
    const paidAmt = this.tabs.Payments.filter((p) => p.loan_id === loan.id && (p.kind === "principal" || p.kind === "extra"))
      .reduce((s, p) => s + num(p.amount), 0);
    return Math.max(num(loan.outstanding) - paidAmt, 0);
  }

  paidCount(loanId: string): number { return this.schedule(loanId).filter((s) => truthy(s.paid)).length; }

  nextDue(loan: Row): [ISODate | null, number] {
    const sch = this.schedule(loan.id);
    if (sch.length) {
      const up = sch.find((s) => !truthy(s.paid));
      return up ? [toDate(up.due_date), num(up.emi)] : [null, 0];
    }
    if (loan.type === "bullet") {
      const due = toDate(loan.deadline);
      const t = today();
      if (!due) return [null, num(loan.emi)];
      for (let k = 0; k < 14; k++) {
        const m = addMonths(firstOfMonth(t), k);
        for (const [, d, amt] of L.bulletMonthItems(this.outstanding(loan), num(loan.rate_pa), m, due)) if (d >= t) return [d, amt];
      }
      return [due, this.outstanding(loan)];
    }
    if (loan.type === "interest_free_deadline") return [toDate(loan.deadline), this.outstanding(loan)];
    return [null, num(loan.emi)];
  }

  monthlyDue(loan: Row): number {
    if (loan.status === "closed" || this.outstanding(loan) <= 0.005) return 0;
    if (loan.type === "interest_only" || loan.type === "bullet") return (this.outstanding(loan) * num(loan.rate_pa)) / 1200;
    if (loan.type === "interest_free_deadline") return this.outstanding(loan) / this.monthsToDeadline(loan);
    return num(loan.emi);
  }

  /** (interest still to pay until the due date, the same if `extra` is paid today). */
  bulletEffect(loan: Row, extra: number): [number, number] {
    const due = toDate(loan.deadline);
    const days = due ? Math.max(diffDays(due, today()), 0) : 0;
    const bal = this.outstanding(loan), rate = num(loan.rate_pa);
    return [L.interestForDays(bal, rate, days), L.interestForDays(Math.max(bal - extra, 0), rate, days)];
  }

  bulletSavePerMonth(loan: Row): number { return this.outstanding(loan) / this.monthsToDeadline(loan); }

  /** Whole months left until the deadline (at least 1). */
  monthsToDeadline(loan: Row): number {
    const dl = toDate(loan.deadline);
    return dl ? Math.max(monthsBetween(today(), dl), 1) : 1;
  }

  activeLoans(): Row[] { return this.loans.filter((r) => r.status !== "closed" && this.outstanding(r) > 0.005); }

  debts(): Debt[] {
    return this.activeLoans().map((r) => ({ id: r.id, name: r.name, balance: this.outstanding(r), rate: num(r.rate_pa),
      min_payment: this.monthlyDue(r), kind: r.type, deadline: toDate(r.deadline) }));
  }

  /** Fixed income always counts; variable/one-off only once ticked Received (conservative) or as soon as listed. */
  incomeThisMonth(month?: string, conservative = true): number {
    return Object.values(this.incomeByPerson(month, conservative)).reduce((a, b) => a + b, 0);
  }

  incomeByPerson(month?: string, conservative = true): Record<string, number> {
    month = month || monthKey(today());
    const out: Record<string, number> = {};
    for (const r of this.tabs.Income.filter((x) => x.month === month)) {
      if (r.type === "fixed" || truthy(r.received) || !conservative) out[r.person] = (out[r.person] || 0) + num(r.amount);
    }
    return out;
  }

  receivedByPerson(month?: string): Record<string, number> {
    month = month || monthKey(today());
    const out: Record<string, number> = {};
    for (const r of this.tabs.Income.filter((x) => x.month === month && truthy(x.received))) out[r.person] = (out[r.person] || 0) + num(r.amount);
    return out;
  }

  /** Expenses that apply to `month`: every-month ones plus those listing that month. */
  expensesFor(month?: string): Row[] {
    month = month || monthKey(today());
    return this.tabs.Expenses.filter((r) => {
      const months = String(r.month ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      return !months.length || months.includes(month!);
    });
  }

  expensesTotal(month?: string): number { return this.expensesFor(month).reduce((s, r) => s + num(r.amount), 0); }

  /** Goals with what is saved so far (opening amount + every logged saving). */
  goals(): Row[] {
    return this.tabs.Goals.map((g) => {
      const mine = this.tabs.SavingsLog.filter((l) => String(l.goal_id) === String(g.id));
      return { ...g, percent: num(g.percent), target: num(g.target), saved_total: num(g.saved) + mine.reduce((s, l) => s + num(l.amount), 0) };
    });
  }

  savedInMonth(goalId: string, month: string): number {
    return this.tabs.SavingsLog.filter((l) => String(l.goal_id) === String(goalId) && String(l.month) === month).reduce((s, l) => s + num(l.amount), 0);
  }

  persons(): string[] { return String(this.settings.persons ?? "").split(",").map((p) => p.trim()).filter(Boolean); }

  /** Per person for a month: what they earn and what they actually paid. An unassigned payment is credited to the loan's owner when that owner is an earner. */
  peopleSummary(month?: string, skipItems = new Set<string>(), skipExtras = new Set<string>(), skipIncome = new Set<string>()): PersonSummary[] {
    month = month || monthKey(today());
    const expInc: Record<string, number> = {}, recInc: Record<string, number> = {};
    for (const r of this.tabs.Income.filter((x) => x.month === month)) {
      if (skipIncome.has(`${r.tab}|${r.row}`)) continue;
      expInc[r.person] = (expInc[r.person] || 0) + num(r.amount);
      if (truthy(r.received)) recInc[r.person] = (recInc[r.person] || 0) + num(r.amount);
    }
    const items = this.tabs.MonthItems.filter((i) => i.month === month && i.paid && !skipItems.has(i.ref));
    const extras = this.tabs.Extras.filter((e) => e.month === month && truthy(e.applied) && !skipExtras.has(`${e.tab}|${e.row}`));
    const names = [...this.persons()];
    const ownerOf: Record<string, string> = Object.fromEntries(this.loans.map((l) => [l.id, String(l.owner ?? "").trim()]));
    for (const n of [...Object.keys(expInc), ...items.map((i) => i.paid_by), ...extras.map((e) => e.paid_by)]) {
      const s = String(n ?? "").trim();
      if (s && !names.includes(s)) names.push(s);
    }
    const payer = (paidBy: unknown, owner: unknown) => {
      const p = String(paidBy ?? "").trim(), o = String(owner ?? "").trim();
      return p || (names.includes(o) ? o : "");
    };
    const tot: Record<string, { loans: number; expenses: number; extra: number }> = {};
    for (const n of [...names, ""]) tot[n] = { loans: 0, expenses: 0, extra: 0 };
    for (const r of items) tot[payer(r.paid_by, r.owner)][r.kind === "loan" ? "loans" : "expenses"] += num(r.amount);
    for (const r of extras) tot[payer(r.paid_by, ownerOf[r.loan_id] ?? "")].extra += num(r.amount);
    const rows: PersonSummary[] = [];
    for (const [n, v] of Object.entries(tot)) {
      const paid = v.loans + v.expenses + v.extra;
      if (!n && !paid) continue;
      const rec = recInc[n] || 0;
      rows.push({ person: n || "Not assigned", expected: expInc[n] || 0, received: rec, loans: v.loans, expenses: v.expenses, extra: v.extra, paid, net: n ? rec - paid : 0 });
    }
    return rows;
  }

  /** Extra payments typed into a month tab that the app has not applied yet. */
  pendingExtras(): Row[] { return this.tabs.Extras.filter((r) => !truthy(r.applied)); }

  monthTabFor(mk: string): Row[] | null {
    const rows = this.tabs.MonthItems.filter((i) => i.month === mk);
    return rows.length ? rows : null;
  }
}

export const emptyTabs = (): Tabs => ({ Loans: [], Schedule: [], Payments: [], Extras: [], Income: [], MonthItems: [], Recurring: [],
  Expenses: [], Goals: [], Holdings: [], SavingsLog: [], Settings: [] });
