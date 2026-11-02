/** The write API: one named action per thing the UI can do. Every action ends with a sync, and the fresh data goes back to the browser. */
import "server-only";
import * as A from "./actions";
import { parseDate } from "./dates";
import { Row, State } from "./state";
import { Store } from "./store";

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (store: Store, state: State, a: Args) => Promise<unknown>;

const loanOf = (state: State, id: string): Row => {
  const l = state.loans.find((x) => x.id === id);
  if (!l) throw new Error("Loan not found");
  return l;
};

export const ACTIONS: Record<string, Handler> = {
  // month tab ticks
  setItemPaid: (s, _, a) => s.setItemPaid(a.tab, a.row, a.paid, a.amount ?? null, a.paidBy ?? null),
  setItemsPaid: (s, _, a) => s.setItemsPaid(a.rows, a.paid ?? true, a.paidBy ?? ""),
  setIncomeReceived: (s, _, a) => s.setIncomeReceived(a.tab, a.row, !!a.value),
  appendExtra: (s, _, a) => s.appendExtra(a.month, a.loanName, a.amount, a.note ?? "", a.applied ?? false, a.result ?? "", a.paidBy ?? ""),
  addIncome: (s, _, a) => s.addIncome(a.month, a.person, a.source, a.amount, a.type ?? "variable", !!a.received),
  addRecurring: (s, _, a) => s.addRecurring(a.person, a.source, a.amount, a.also ?? undefined),
  // loans
  createEmiLoan: async (s, _, a) => A.createEmiLoan(s, { ...a, first_due: parseDate(a.first_due)!, schedule: a.schedule ?? null } as never),
  createSimpleLoan: (s, _, a) => A.createSimpleLoan(s, a as never),
  createBulletLoan: (s, _, a) => A.createBulletLoan(s, { ...a, start: parseDate(a.start)! } as never),
  editLoan: (s, st, a) => A.editLoan(s, st, loanOf(st, a.loanId), a as never),
  deleteLoan: (s, _, a) => s.deleteLoan(a.loanId),
  setPaidThrough: (s, _, a) => A.setPaidThrough(s, a.loanId, a.n),
  logPayment: (s, st, a) => A.logPayment(s, loanOf(st, a.loanId), a.amount, a.note ?? "", a.paidBy ?? ""),
  applyPrepayment: (s, st, a) => A.applyPrepayment(s, st, loanOf(st, a.loanId), a.amount, a.keepEmi ?? true, a.extra ?? null, a.paidBy ?? ""),
  applySimpleExtra: (s, _, a) => A.applySimpleExtra(s, a.extra),
  // flat tables (Expenses, Goals, Savings Log, Holdings)
  append: (s, _, a) => s.append(a.tab, [a.row]),
  updateFlat: (s, _, a) => s.updateFlat(a.tab, a.row, a.vals),
  deleteFlat: (s, _, a) => s.deleteFlat(a.tab, a.row),
  setSetting: (s, _, a) => s.setSetting(a.key, a.value),
};
