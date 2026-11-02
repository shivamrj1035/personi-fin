/** Server-side actions (port of core/service.py): loan creation, payments, prepayments, edits. */
import "server-only";
import { ISODate, fmtDate, monthTitle, parseDate, today } from "./dates";
import * as L from "./loans";
import { Row, State, num, truthy } from "./state";
import { Store } from "./store";

type Statuses = Record<number, [string, string]>;

const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.inst_no - b.inst_no);
const keepRow = (r: Row): L.ScheduleRow => ({ inst_no: Math.trunc(r.inst_no), due_date: parseDate(r.due_date), opening: num(r.opening),
  principal: num(r.principal), interest: num(r.interest), emi: num(r.emi), closing: num(r.closing) });

export async function createEmiLoan(store: Store, p: { name: string; lender: string; owner: string; principal: number; rate: number; emi: number;
  months: number; first_due: ISODate; paid: number; rate_type?: string; prepay_charge?: number; notes?: string; schedule?: L.ScheduleRow[] | null }): Promise<string> {
  const sched = p.schedule?.length ? p.schedule : L.schedule(p.principal, p.rate, p.emi, p.months, p.first_due);
  const id = await store.createLoanTab({ name: p.name, lender: p.lender, owner: p.owner, type: "bank_emi", principal: p.principal, rate_pa: p.rate, emi: p.emi,
    tenure_months: sched.length, first_due_date: p.first_due, rate_type: p.rate_type ?? "floating", prepay_charge_pct: p.prepay_charge ?? 0,
    deadline: "", status: "active", outstanding: p.principal, notes: p.notes ?? "" }, sched, p.paid);
  await store.sync();
  return id;
}

export async function createSimpleLoan(store: Store, p: { name: string; owner: string; kind: string; outstanding: number; monthly?: number; rate?: number;
  deadline?: ISODate | null; notes?: string }): Promise<string> {
  const id = await store.createLoanTab({ name: p.name, lender: "Personal", owner: p.owner, type: p.kind, principal: p.outstanding, rate_pa: p.rate ?? 0,
    emi: p.monthly ?? 0, tenure_months: "", first_due_date: today(), rate_type: "fixed", prepay_charge_pct: 0, deadline: p.deadline ?? "",
    status: "active", outstanding: p.outstanding, notes: p.notes ?? "" }, null);
  await store.sync();
  return id;
}

/** A gold-style loan: interest paid every month, the principal in one go on the due date. */
export async function createBulletLoan(store: Store, p: { name: string; lender: string; owner: string; principal: number; rate: number; start: ISODate;
  months: number; rate_type?: string; prepay_charge?: number; notes?: string }): Promise<string> {
  const due = (await import("./dates")).addMonths(p.start, p.months);
  const id = await store.createLoanTab({ name: p.name, lender: p.lender, owner: p.owner, type: "bullet", principal: p.principal, rate_pa: p.rate,
    emi: L.round((p.principal * p.rate) / 1200, 2), tenure_months: p.months, first_due_date: p.start, rate_type: p.rate_type ?? "fixed",
    prepay_charge_pct: p.prepay_charge ?? 0, deadline: due, status: "active", outstanding: p.principal, notes: p.notes ?? "" }, null);
  await store.sync();
  return id;
}

export const setPaidThrough = (store: Store, loanId: string, n: number) => store.setPaidThrough(loanId, n);

/** An extra payment made now: recorded (already applied) in this month's tab. */
export async function logPayment(store: Store, loan: Row, amount: number, note = "", paidBy = ""): Promise<void> {
  await store.appendExtra(today(), loan.name, amount, note || "recorded in app", true, "recorded", paidBy);
  await store.sync();
}

/** Reduce principal now and rebuild the unpaid part of the schedule. `extra` is the month-tab row the payment came from. */
export async function applyPrepayment(store: Store, state: State, loan: Row, amount: number, keepEmi = true, extra?: Row | null, paidBy = ""):
  Promise<{ new_months: number; new_emi: number; result: string }> {
  const sch = sorted(state.schedule(loan.id));
  const paid = sch.filter((r) => truthy(r.paid)), unpaid = sch.filter((r) => !truthy(r.paid));
  const bal = state.outstanding(loan) - amount;
  const rate = num(loan.rate_pa);
  let emiAmt = num(loan.emi);
  const remaining = unpaid.length;
  const oldEnd = parseDate(sch[sch.length - 1].due_date)!;
  let newRows: L.ScheduleRow[] = [];
  if (!(bal <= 0.005 || !remaining)) {
    if (!keepEmi) emiAmt = L.emi(bal, rate, remaining);
    newRows = L.schedule(bal, rate, emiAmt, 600, parseDate(unpaid[0].due_date)!);
    for (const r of newRows) r.inst_no += paid.length;
  }
  const rows: L.ScheduleRow[] = [], statuses: Statuses = {};
  for (const r of paid) { rows.push(keepRow(r)); statuses[Math.trunc(r.inst_no)] = ["Paid", r.paid_date]; }
  rows.push(...newRows);
  await store.writeSchedule(loan.tab, rows, statuses);
  await store.updateMeta(loan.tab, { emi: L.round(emiAmt, 2), status: newRows.length ? "active" : "closed", tenure_months: rows.length });
  const newEnd = newRows.length ? newRows[newRows.length - 1].due_date! : today();
  const result = !newRows.length ? "Cleared! " : `${keepEmi ? "EMI kept" : "EMI now " + Math.round(emiAmt)}; ends ${monthTitle(newEnd)} (was ${monthTitle(oldEnd)})`;
  if (extra) await store.markExtraApplied(extra.tab, Math.trunc(extra.row), result);
  else await store.appendExtra(today(), loan.name, amount, "part-prepayment", true, result, paidBy);
  await store.sync();
  return { new_months: newRows.length, new_emi: emiAmt, result };
}

export async function applySimpleExtra(store: Store, extra: Row): Promise<void> {
  await store.markExtraApplied(extra.tab, Math.trunc(extra.row), "applied");
  await store.sync();
}

/** Apply edits. Changing the rate or EMI of a scheduled loan rebuilds its unpaid instalments. */
export async function editLoan(store: Store, state: State, loan: Row, p: { name: string; lender: string; owner: string; rate: number; emi: number;
  rate_type: string; prepay_charge: number; deadline?: ISODate | null; notes: string; paid?: number | null; first_due?: ISODate | null }): Promise<void> {
  const lid = loan.id, sch = sorted(state.schedule(lid));
  let emi = p.emi;
  if (loan.type === "bullet") emi = L.round((num(loan.principal) * p.rate) / 1200, 2); // typical monthly interest
  const meta: Row = { lender: p.lender, owner: p.owner, rate_pa: p.rate, emi, rate_type: p.rate_type, prepay_charge_pct: p.prepay_charge, notes: p.notes };
  if (p.first_due) meta.first_due_date = p.first_due;
  if (p.deadline) meta.deadline = p.deadline; // never blank a due date just because the dialog didn't show one
  await store.updateMeta(loan.tab, meta);
  if (sch.length && (Math.abs(p.rate - num(loan.rate_pa)) > 1e-9 || Math.abs(emi - num(loan.emi)) > 0.005)) {
    const paidRows = sch.filter((r) => truthy(r.paid)), unpaid = sch.filter((r) => !truthy(r.paid));
    const bal = state.outstanding(loan);
    const rows: L.ScheduleRow[] = [], statuses: Statuses = {};
    for (const r of paidRows) { rows.push(keepRow(r)); statuses[Math.trunc(r.inst_no)] = ["Paid", r.paid_date]; }
    if (unpaid.length && bal > 0.005) {
      for (const r of L.schedule(bal, p.rate, emi, 600, parseDate(unpaid[0].due_date)!)) { r.inst_no += paidRows.length; rows.push(r); }
    }
    await store.writeSchedule(loan.tab, rows, statuses);
    await store.updateMeta(loan.tab, { tenure_months: rows.length });
  }
  if (p.paid != null && sch.length && p.paid !== state.paidCount(lid)) await store.setPaidThrough(lid, p.paid);
  if (p.name.trim() && p.name.trim() !== loan.name) await store.renameLoan(loan.tab, p.name.trim());
  await store.sync();
}

export { fmtDate };
