/** Month report card (HTML) in English or Gujarati. The browser turns it into a PNG/PDF. Port of core/report.py. */
import { ISODate, MONTHS_LONG, monthKey, nextMonth, parseDate, today, fmtDate } from "./dates";
import { Row, State, num, truthy } from "./state";

export const SECTIONS = ["summary", "income", "people", "loans", "expenses", "balances"] as const;
export type Lang = "en" | "gu";

const GU_MONTHS = ["જાન્યુઆરી", "ફેબ્રુઆરી", "માર્ચ", "એપ્રિલ", "મે", "જૂન", "જુલાઈ", "ઓગસ્ટ", "સપ્ટેમ્બર", "ઓક્ટોબર", "નવેમ્બર", "ડિસેમ્બર"];
const T: Record<Lang, Record<string, string>> = {
  en: { title: "Monthly report", income: "Income", loans: "Loan payments", expenses: "Expenses", balances: "Loan balances", summary: "Summary", person: "Person", expected: "Expected",
    received: "Received", total: "Total", loan: "Loan", due: "Due", amount: "Amount", status: "Status", paid: "Paid", pending: "Pending", overdue: "Overdue", item: "Expense",
    outstanding: "Outstanding", rate: "Rate", next: "Next due", income_expected: "Income expected", income_received: "Income received", emis_due: "Loan payments due",
    emis_paid: "Loan payments paid", exp_planned: "Expenses planned", exp_paid: "Expenses paid", left: "Left this month", target: "Next month: can add extra",
    nothing: "Nothing here this month", generated: "Generated", emi: "EMI", monthly: "Monthly payment", interest: "Interest", final_interest: "Final interest",
    repay_principal: "Repay principal", days: "days", carried: "carried from", total_pay: "Total payments (loans + expenses)", total_paid: "Paid so far (loans + expenses)",
    people: "Who earned & paid what", paid_loans: "Loans", paid_exp: "Expenses", paid_extra: "Extra", paid_total: "Total paid", net: "Left (received - paid)", not_assigned: "Not assigned" },
  gu: { title: "માસિક અહેવાલ", income: "આવક", loans: "લોનની ચુકવણી", expenses: "ખર્ચ", balances: "લોનની બાકી રકમ", summary: "સારાંશ", person: "વ્યક્તિ", expected: "અપેક્ષિત",
    received: "મળેલ", total: "કુલ", loan: "લોન", due: "તારીખ", amount: "રકમ", status: "સ્થિતિ", paid: "ચૂકવ્યું", pending: "બાકી", overdue: "મુદત વીતી", item: "ખર્ચ",
    outstanding: "બાકી રકમ", rate: "વ્યાજ", next: "આગામી તારીખ", income_expected: "અપેક્ષિત આવક", income_received: "મળેલ આવક", emis_due: "લોન ચુકવણી બાકી",
    emis_paid: "લોન ચુકવણી ચૂકવી", exp_planned: "આયોજિત ખર્ચ", exp_paid: "ચૂકવેલ ખર્ચ", left: "આ મહિને વધ્યા", target: "આવતા મહિને વધારાના ભરી શકાય",
    nothing: "આ મહિને કંઈ નથી", generated: "તૈયાર કર્યું", emi: "હપ્તો", monthly: "માસિક ચુકવણી", interest: "વ્યાજ", final_interest: "અંતિમ વ્યાજ",
    repay_principal: "મુદ્દલ ચૂકવો", days: "દિવસ", carried: "આગળ લાવેલ", total_pay: "કુલ ચુકવણી (લોન + ખર્ચ)", total_paid: "અત્યાર સુધી ચૂકવ્યું (લોન + ખર્ચ)",
    people: "કોણે કેટલું કમાયું અને ચૂકવ્યું", paid_loans: "લોન", paid_exp: "ખર્ચ", paid_extra: "વધારાનું", paid_total: "કુલ ચૂકવ્યું", net: "બાકી (મળેલ - ચૂકવ્યું)", not_assigned: "નક્કી નથી" },
};
const CAT_GU: Record<string, string> = { Rent: "ભાડું", Utilities: "બિલ / યુટિલિટી", Groceries: "કરિયાણું", "School fees": "શાળા ફી", Insurance: "વીમો", Subscriptions: "સબ્સ્ક્રિપ્શન",
  Transport: "મુસાફરી", Medical: "દવા / તબીબી", Family: "પરિવાર", Other: "અન્ય", Expense: "ખર્ચ" };

export function inr(x: number): string {
  const v = Math.round(x || 0), s = String(Math.abs(v));
  const g = s.length > 3 ? s.slice(0, -3).replace(/(\d)(?=(\d\d)+$)/g, "$1,") + "," + s.slice(-3) : s;
  return `${v < 0 ? "-" : ""}₹${g}`;
}
const monthName = (m: ISODate, lang: Lang) => { const mi = Number(m.slice(5, 7)) - 1; return `${(lang === "gu" ? GU_MONTHS : MONTHS_LONG)[mi]} ${m.slice(0, 4)}`; };
const esc = (x: unknown) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function trLabel(label: string, lang: Lang): string {
  if (lang !== "gu") return label;
  const t = T.gu;
  let carried = "";
  const m = /\s*-\s*carried from ([A-Z][a-z]{2}) (\d{4})/.exec(label);
  if (m) { const mi = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]); carried = ` (${t.carried} ${GU_MONTHS[mi]} ${m[2]})`; label = label.slice(0, m.index); }
  label = label.replace(/^EMI #(\d+)/, (_, n) => `${t.emi} #${n}`).replace(/^Interest \((\d+) days\)/, (_, n) => `${t.interest} (${n} ${t.days})`)
    .replace(/^Final interest \((\d+) days\)/, (_, n) => `${t.final_interest} (${n} ${t.days})`);
  label = ({ "Monthly payment": t.monthly, "Repay principal": t.repay_principal } as Record<string, string>)[label] ?? label;
  return (CAT_GU[label] ?? label) + carried;
}
function dateLabel(s: unknown, lang: Lang): string {
  const d = parseDate(s);
  if (!d) return String(s);
  const mi = Number(d.slice(5, 7)) - 1;
  return `${Number(d.slice(8))} ${lang === "gu" ? GU_MONTHS[mi] : MONTHS_LONG[mi].slice(0, 3)}`;
}

/** Every entry that can appear in the report, grouped by section, with a stable key for excluding it. */
export function entries(state: State, m: ISODate): Record<"income" | "loans" | "expenses" | "balances", { key: string; label: string; amount: number }[]> {
  const mk = monthKey(m);
  const out = { income: [] as { key: string; label: string; amount: number }[], loans: [] as { key: string; label: string; amount: number }[],
    expenses: [] as { key: string; label: string; amount: number }[], balances: [] as { key: string; label: string; amount: number }[] };
  for (const r of state.tabs.Income.filter((x) => x.month === mk)) out.income.push({ key: `n:${r.tab}|${r.row}`, label: `${r.person} - ${r.source}`, amount: num(r.amount) });
  for (const r of state.tabs.MonthItems.filter((x) => x.month === mk)) out[r.kind === "expense" ? "expenses" : "loans"].push({ key: `i:${r.ref}`, label: `${r.loan} - ${r.label}`, amount: num(r.amount) });
  for (const r of state.tabs.Extras.filter((x) => x.month === mk && truthy(x.applied))) out.loans.push({ key: `x:${r.tab}|${r.row}`, label: `${r.loan} - extra payment`, amount: num(r.amount) });
  for (const l of [...state.activeLoans()].sort((a, b) => state.outstanding(b) - state.outstanding(a))) out.balances.push({ key: `b:${l.id}`, label: l.name, amount: state.outstanding(l) });
  return out;
}

export function buildReport(state: State, m: ISODate, sections: string[], lang: Lang = "en", excluded: ReadonlySet<string> = new Set()): string {
  const t = T[lang], mk = monthKey(m);
  const cur = state.tabs.MonthItems.filter((i) => i.month === mk);
  const allExp = cur.filter((i) => i.kind === "expense").length;
  const loans = cur.filter((i) => i.kind === "loan" && !excluded.has(`i:${i.ref}`));
  const exps = cur.filter((i) => i.kind === "expense" && !excluded.has(`i:${i.ref}`));
  const keys = (p: string) => new Set([...excluded].filter((k) => k.startsWith(p)).map((k) => k.slice(2)));
  const skipItems = keys("i:"), skipExtras = keys("x:"), skipIncome = keys("n:");
  const incRows = state.tabs.Income.filter((r) => r.month === mk && !skipIncome.has(`${r.tab}|${r.row}`));
  const nm = nextMonth(m);
  const nxt = state.tabs.MonthItems.filter((i) => i.month === monthKey(nm) && i.kind === "loan");
  const extras = state.tabs.Extras.filter((e) => e.month === mk && truthy(e.applied) && !skipExtras.has(`${e.tab}|${e.row}`)).reduce((s, e) => s + num(e.amount), 0);
  const expPer: Record<string, number> = {}, recPer: Record<string, number> = {};
  for (const r of incRows) { expPer[r.person] = (expPer[r.person] || 0) + num(r.amount); if (truthy(r.received)) recPer[r.person] = (recPer[r.person] || 0) + num(r.amount); }
  const sum = (xs: Row[], f: (x: Row) => number = (x) => x.amount) => xs.reduce((s, x) => s + f(x), 0);
  const income = sum(Object.values(expPer).map((v) => ({ amount: v }))), received = sum(Object.values(recPer).map((v) => ({ amount: v })));
  const due = sum(loans), paid = sum(loans.filter((l) => l.paid)), eDue = sum(exps), ePaid = sum(exps.filter((l) => l.paid));
  const planned = allExp ? eDue : state.expensesTotal(mk);
  const left = income - planned - due - extras;
  const buffer = num(state.settings.emergency_buffer);
  const recurring = sum(state.tabs.Recurring, (r) => num(r.amount));
  const target = Math.max(recurring - state.expensesTotal(monthKey(nm)) - sum(nxt) - buffer, 0);

  const th = "text-align:left;font-size:12px;letter-spacing:.04em;color:#475569;padding:8px 10px;background:#eef2ff;";
  const td = "padding:9px 10px;font-size:14px;border-bottom:1px solid #f1f5f9;";
  const out: string[] = [
    `<div id="report-card" style="font-family:'Noto Sans Gujarati','Inter',-apple-system,'Segoe UI',sans-serif;width:880px;background:#ffffff;color:#0f172a;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">`,
    `<div style="background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;padding:22px 28px;"><div style="font-size:13px;opacity:.85;">EL Smart Tracker</div><div style="font-size:28px;font-weight:700;margin-top:2px;">${esc(t.title)} - ${esc(monthName(m, lang))}</div></div>`,
    `<div style="padding:22px 28px;display:flex;flex-direction:column;gap:22px;">`];
  const kpi = (label: string, value: string, tone = "#0f172a") => `<div style="flex:1;min-width:170px;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;"><div style="font-size:12px;color:#64748b;">${esc(label)}</div><div style="font-size:22px;font-weight:700;color:${tone};margin-top:2px;">${esc(value)}</div></div>`;
  const table = (head: string[], rows: string[]) => rows.length ? `<table style="width:100%;border-collapse:collapse;"><thead><tr>${head.map((h) => `<th style="${th}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div style="color:#64748b;font-size:14px;">${esc(t.nothing)}</div>`;
  const h = (title: string) => `<div style="font-size:17px;font-weight:700;color:#3730a3;margin-bottom:8px;">${esc(title)}</div>`;
  const chip = (kind: "paid" | "pending" | "overdue") => { const c = { paid: ["#dcfce7", "#166534"], pending: ["#fef3c7", "#92400e"], overdue: ["#fee2e2", "#991b1b"] }[kind];
    return `<span style="background:${c[0]};color:${c[1]};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;">${esc(t[kind])}</span>`; };

  if (sections.includes("summary")) {
    const alone = sections.every((s) => s === "summary");
    const hasInc = sections.includes("income") || alone, hasLoans = sections.includes("loans") || alone, hasExp = sections.includes("expenses") || alone;
    const k: string[] = [];
    if (hasInc) k.push(kpi(t.income_expected, inr(income)), kpi(t.income_received, inr(received), "#15803d"));
    if (hasExp) k.push(kpi(t.exp_planned, inr(planned)));
    if (hasLoans) k.push(kpi(t.emis_due, inr(due)));
    if (hasLoans && hasExp) k.push(kpi(t.total_pay, inr(due + planned), "#b45309"), kpi(t.total_paid, inr(paid + ePaid), "#15803d"));
    if (hasInc && hasLoans && hasExp) k.push(kpi(t.left, inr(left), left >= 0 ? "#15803d" : "#b91c1c"), kpi(t.target, inr(target), "#4338ca"));
    const lines: string[] = [];
    if (hasLoans) lines.push(`${esc(t.emis_paid)}: ${inr(paid)} / ${inr(due)}`);
    if (hasExp) lines.push(`${esc(t.exp_paid)}: ${inr(ePaid)} / ${inr(eDue)}`);
    if (k.length || lines.length) out.push(h(t.summary) + (k.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;">${k.join("")}</div>` : "") + (lines.length ? `<div style="font-size:13px;color:#475569;margin-top:8px;">${lines.join(" &nbsp;|&nbsp; ")}</div>` : ""));
  }
  if (sections.includes("income")) {
    const rows = Object.keys(expPer).sort().map((p) => `<tr><td style="${td}">${esc(p)}</td><td style="${td}">${inr(expPer[p] || 0)}</td><td style="${td}color:#15803d;">${inr(recPer[p] || 0)}</td></tr>`);
    if (rows.length) rows.push(`<tr><td style="${td}font-weight:700;">${esc(t.total)}</td><td style="${td}font-weight:700;">${inr(income)}</td><td style="${td}font-weight:700;color:#15803d;">${inr(received)}</td></tr>`);
    const src = incRows.map((r) => `<tr><td style="${td}">${esc(r.person)}</td><td style="${td}">${esc(r.source)}</td><td style="${td}">${inr(num(r.amount))}</td><td style="${td}">${truthy(r.received) ? chip("paid") : chip("pending")}</td></tr>`);
    out.push(h(t.income) + table([t.person, t.expected, t.received], rows) + (src.length ? `<div style="height:10px"></div>` + table([t.person, t.income, t.amount, t.status], src) : ""));
  }
  if (sections.includes("people")) {
    const prow = state.peopleSummary(mk, skipItems, skipExtras, skipIncome).map((p) => {
      const who = p.person === "Not assigned" ? t.not_assigned : p.person, col = p.net >= 0 ? "#15803d" : "#b91c1c";
      return `<tr><td style="${td}font-weight:600;">${esc(who)}</td><td style="${td}">${inr(p.expected)}</td><td style="${td}">${inr(p.received)}</td><td style="${td}">${inr(p.loans)}</td><td style="${td}">${inr(p.expenses)}</td><td style="${td}">${inr(p.extra)}</td><td style="${td}font-weight:700;">${inr(p.paid)}</td><td style="${td}font-weight:700;color:${col};">${p.person === "Not assigned" ? "-" : inr(p.net)}</td></tr>`; });
    out.push(h(t.people) + table([t.person, t.expected, t.received, t.paid_loans, t.paid_exp, t.paid_extra, t.paid_total, t.net], prow));
  }
  const payRows = (df: Row[]) => {
    const rows = df.map((r) => { const carried = String(r.ref).startsWith("carry:"); const kind = r.paid ? "paid" : carried ? "overdue" : "pending";
      return `<tr style="${carried && !r.paid ? "background:#fee2e2;" : ""}"><td style="${td}">${esc(r.loan)}<div style="font-size:12px;color:#64748b;">${esc(trLabel(String(r.label), lang))}</div></td><td style="${td}">${esc(dateLabel(r.due, lang))}</td><td style="${td}font-weight:600;">${inr(r.amount)}</td><td style="${td}">${chip(kind as "paid")}</td></tr>`; });
    if (rows.length) rows.push(`<tr><td style="${td}font-weight:700;">${esc(t.total)}</td><td style="${td}"></td><td style="${td}font-weight:700;">${inr(sum(df))}</td><td style="${td}"></td></tr>`);
    return rows;
  };
  if (sections.includes("loans")) out.push(h(t.loans) + table([t.loan, t.due, t.amount, t.status], payRows(loans)));
  if (sections.includes("expenses")) out.push(h(t.expenses) + table([t.item, t.due, t.amount, t.status], payRows(exps)));
  if (sections.includes("balances")) {
    let bal = 0;
    const rows: string[] = [];
    for (const l of [...state.activeLoans()].sort((a, b) => state.outstanding(b) - state.outstanding(a))) {
      if (excluded.has(`b:${l.id}`)) continue;
      bal += state.outstanding(l);
      const [nd] = state.nextDue(l);
      rows.push(`<tr><td style="${td}">${esc(l.name)}<div style="font-size:12px;color:#64748b;">${esc(l.owner || "")}</div></td><td style="${td}font-weight:600;">${inr(state.outstanding(l))}</td><td style="${td}">${num(l.rate_pa)}%</td><td style="${td}">${nd ? esc(dateLabel(nd, lang)) : "-"}</td></tr>`);
    }
    if (rows.length) rows.push(`<tr><td style="${td}font-weight:700;">${esc(t.total)}</td><td style="${td}font-weight:700;">${inr(bal)}</td><td style="${td}"></td><td style="${td}"></td></tr>`);
    out.push(h(t.balances) + table([t.loan, t.outstanding, t.rate, t.next], rows));
  }
  out.push(`<div style="font-size:11px;color:#94a3b8;text-align:right;">${esc(t.generated)}: ${esc(fmtDate(today()))}</div></div></div>`);
  return out.join("");
}
