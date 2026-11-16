import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { inr } from "./report";
import { Row, State, num } from "./state";
import { Op } from "./activity-types";

export const pack = (ops: Op[]): string => {
  const s = gzipSync(JSON.stringify(ops)).toString("base64");
  return s.length > 48_000 ? "" : s; // a Sheet cell holds at most 50,000 characters
};
export const unpack = (s: unknown): Op[] => { try { return s ? (JSON.parse(gunzipSync(Buffer.from(String(s), "base64")).toString("utf8")) as Op[]) : []; } catch { return []; } };

const TAB_KEY: Record<string, string> = { Expenses: "Expenses", Goals: "Goals", Holdings: "Holdings", "Savings Log": "SavingsLog", "Recurring Income": "Recurring" };
const NOUN: Record<string, string> = { Expenses: "expense", Goals: "goal", Holdings: "holding", "Savings Log": "saving", "Recurring Income": "fixed income" };
const label = (r: Row | undefined) => (r ? String(r.name || r.symbol || r.source || r.note || "item") : "item");

/** One human sentence for the log, written from the state as it was BEFORE the change. */
export function describe(name: string, a: Record<string, any>, st: State): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const loan = a.loanId ? st.loans.find((l) => l.id === a.loanId) : undefined;
  const item = a.tab && a.row ? st.tabs.MonthItems.find((i) => i.tab === a.tab && i.row === a.row) : undefined;
  switch (name) {
    case "setItemPaid": return `${a.paid ? "Marked paid" : "Marked unpaid"}: ${item ? `${item.loan} - ${item.label}` : "payment"} (${inr(a.amount ?? item?.amount ?? 0)})`;
    case "setItemsPaid": return `Marked ${a.rows?.length ?? 0} payment${a.rows?.length === 1 ? "" : "s"} ${a.paid === false ? "unpaid" : "paid"}`;
    case "setIncomeReceived": { const r = st.tabs.Income.find((i) => i.tab === a.tab && i.row === a.row); return `${a.value ? "Received" : "Un-received"}: ${r ? `${r.person} - ${r.source} (${inr(num(r.amount))})` : "income"}`; }
    case "appendExtra": return `Extra payment ${inr(a.amount)} toward ${a.loanName}`;
    case "addIncome": return `Added income ${inr(a.amount)}: ${a.person} - ${a.source}`;
    case "addRecurring": return `Added fixed income ${inr(a.amount)}/month: ${a.person} - ${a.source}`;
    case "createEmiLoan": case "createSimpleLoan": case "createBulletLoan": return `Added loan: ${a.name}`;
    case "editLoan": return `Edited loan: ${loan?.name ?? a.name}`;
    case "deleteLoan": return `Deleted loan: ${loan?.name ?? "loan"}`;
    case "setPaidThrough": return `Set ${loan?.name ?? "loan"} as paid through EMI #${a.n}`;
    case "logPayment": return `Recorded ${inr(a.amount)} on ${loan?.name ?? "loan"}`;
    case "applyPrepayment": return `Applied ${inr(a.amount)} prepayment to ${loan?.name ?? "loan"}`;
    case "applySimpleExtra": return `Applied extra payment${a.extra?.loan ? ` on ${a.extra.loan}` : ""}`;
    case "append": return `Added ${NOUN[a.tab] ?? "entry"}: ${label(a.row)}`;
    case "updateFlat": { const r = st.tabs[TAB_KEY[a.tab] as keyof typeof st.tabs]?.find((x) => x.row === a.row); return `Edited ${NOUN[a.tab] ?? "entry"}: ${label(a.vals ?? r)}`; }
    case "deleteFlat": { const r = st.tabs[TAB_KEY[a.tab] as keyof typeof st.tabs]?.find((x) => x.row === a.row); return `Deleted ${NOUN[a.tab] ?? "entry"}: ${label(r)}`; }
    case "setSetting": return `Changed setting: ${a.key}`;
    default: return name;
  }
}
