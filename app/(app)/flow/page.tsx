"use client";
import { ArrowDownLeft, ArrowUpRight, Info, PiggyBank, Percent, Scale, Sparkles, TriangleAlert, CircleCheck, CircleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ClaudeDialog } from "@/components/answer";
import { Button, Card, Chart, Kpi, KpiGrid, PageHeader, Section, Segmented, cn } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { addMonths, monthKey, monthLong, monthTitle, parseDate } from "@/lib/dates";
import { inr, inrShort } from "@/lib/format";
import { num, truthy, type State, type Tabs } from "@/lib/state";

interface Figures { income: number; loans: number; expenses: number; extras: number; estimated: boolean }

/** Income and outgo for any month: from its tab when it exists, otherwise estimated from schedules and recurring income. */
function monthFigures(state: State, tabs: Tabs, m: string): Figures {
  const key = monthKey(m);
  const mine = tabs.MonthItems.filter((i) => i.month === key);
  const hasTab = tabs.MonthItems.some((i) => i.month === key) || tabs.Income.some((i) => i.month === key);
  const income = hasTab ? state.incomeThisMonth(key, false) : tabs.Recurring.reduce((s, r) => s + num(r.amount), 0);
  let loans = 0;
  if (mine.length) loans = mine.filter((i) => i.kind === "loan").reduce((s, i) => s + num(i.amount), 0);
  else for (const l of state.activeLoans()) {
    const sch = state.schedule(l.id);
    loans += sch.length ? sch.filter((r) => { const d = parseDate(r.due_date); return d && monthKey(d) === key; }).reduce((s, r) => s + num(r.emi), 0) : state.monthlyDue(l);
  }
  const extras = tabs.Extras.filter((e) => e.month === key && truthy(e.applied)).reduce((s, e) => s + num(e.amount), 0);
  return { income, loans, expenses: state.expensesTotal(key), extras, estimated: !hasTab };
}

type Tip = { tone: "good" | "warn" | "bad" | "info"; text: string };
const TIP_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleAlert, info: Info };
const TIP_CLS = { good: "text-good", warn: "text-warn", bad: "text-bad", info: "text-primary" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function FlowPage() {
  const { state, tabs, month, mk } = useData();
  const [basis, setBasis] = useState<"expected" | "received">("expected");
  const [ask, setAsk] = useState(false);

  const mine = tabs.MonthItems.filter((i) => i.month === mk);
  const loans = mine.filter((i) => i.kind === "loan"), exps = mine.filter((i) => i.kind === "expense");
  const incBy = basis === "expected" ? state.incomeByPerson(mk, false) : state.receivedByPerson(mk);
  const income = Object.values(incBy).reduce((a, b) => a + b, 0);
  const f = monthFigures(state, tabs, month);
  const loansDue = loans.reduce((s, i) => s + num(i.amount), 0), expDue = exps.reduce((s, i) => s + num(i.amount), 0);
  const outTotal = loansDue + Math.max(expDue, exps.length ? 0 : f.expenses) + f.extras;
  const net = income - outTotal;
  const people = state.peopleSummary(mk);

  // insights
  const tips: Tip[] = [];
  if (income) {
    const ds = loansDue / income;
    tips.push({ tone: ds > 0.4 ? "warn" : ds > 0.3 ? "info" : "good", text: `Loan payments take ${pct(ds)} of income${ds > 0.4 ? " - high, aim below 40%." : ds > 0.3 ? " - watch it." : " - healthy."}` });
    if (net < 0) tips.push({ tone: "bad", text: `Out is ${inr(-net)} more than income this month - delay extras or trim expenses.` });
    else if (net > 0) tips.push({ tone: "good", text: `${inr(net)} is free - best used as an extra payment on your highest-rate loan.` });
  }
  const carried = mine.filter((i) => String(i.ref).startsWith("carry:") && !i.paid);
  if (carried.length) tips.push({ tone: "bad", text: `${inr(carried.reduce((s, i) => s + num(i.amount), 0))} carried forward from earlier months (${carried.length} items) - pay these first.` });
  const totPaid = people.reduce((s, p) => s + p.paid, 0), totExp = people.reduce((s, p) => s + p.expected, 0);
  for (const p of people) if (totPaid && p.person !== "Not assigned" && p.paid)
    tips.push({ tone: "info", text: `${p.person} paid ${pct(p.paid / totPaid)} of payments so far and earns ${pct(totExp ? p.expected / totExp : 0)} of household income.` });
  const na = people.find((p) => p.person === "Not assigned");
  if (na?.paid) tips.push({ tone: "warn", text: `${inr(na.paid)} of payments have no 'Paid by' - pick who paid when you tick Paid.` });

  // sankey
  const links: [string, string, number][] = [];
  for (const [p, v] of Object.entries(incBy)) if (v > 0) links.push([p, "Household", v]);
  if (outTotal > income) links.push(["Shortfall", "Household", outTotal - income]);
  if (loansDue) links.push(["Household", "Loan payments", loansDue]);
  const cats: Record<string, number> = {};
  for (const r of exps) cats[String(r.label)] = (cats[String(r.label)] || 0) + num(r.amount);
  if (!exps.length && f.expenses) cats.Expenses = f.expenses;
  for (const [c, v] of Object.entries(cats)) links.push(["Household", `${c} (expense)`, v]);
  if (f.extras) links.push(["Household", "Extra payments", f.extras]);
  if (net > 0) links.push(["Household", "Left over", net]);
  const nodes = [...new Set(links.flatMap(([a, b]) => [a, b]))].sort();
  const NODE_COL: Record<string, string> = { Shortfall: "#ef4444", "Left over": "#10b981", "Loan payments": "#4f46e5", Household: "#94a3b8" };

  // over time
  const keys = Array.from({ length: 9 }, (_, i) => addMonths(month, i - 5));
  const figs = keys.map((k) => monthFigures(state, tabs, k));
  const names = people.map((p) => p.person);
  const rnd = (n: number) => Math.round(n);

  return (
    <div className="space-y-6">
      <PageHeader title={`Income ↔ Outgo - ${monthLong(month)}`} subtitle="Who earned what, who paid what, and where the money goes."
        actions={<>
          <Segmented value={basis} onChange={setBasis} options={[{ value: "expected", label: "Expected income" }, { value: "received", label: "Received only" }]} />
          <Button variant="outline" icon={<Sparkles className="h-4 w-4" />} onClick={() => setAsk(true)}>Analyse with Claude</Button></>} />

      <KpiGrid className="lg:grid-cols-5">
        <Kpi label="Income" value={inr(income)} sub={basis === "expected" ? "expected" : "received so far"} icon={<ArrowDownLeft />} tone="good" />
        <Kpi label="Total out" value={inr(outTotal)} sub={`loans ${inr(loansDue)} · expenses ${inr(outTotal - loansDue - f.extras)}`} icon={<ArrowUpRight />} tone="bad" />
        <Kpi label="Net" value={inr(net)} sub="income - out" icon={<Scale />} tone={net >= 0 ? "good" : "bad"} />
        <Kpi label="Debt-service" value={income ? pct(loansDue / income) : "-"} sub="loan payments / income" icon={<Percent />} tone="warn" />
        <Kpi className="col-span-2 lg:col-span-1" label="Savings rate" value={income ? pct(net / income) : "-"} sub="left / income" icon={<PiggyBank />} tone={net >= 0 ? "good" : "bad"} />
      </KpiGrid>

      {tips.length > 0 && (
        <Card className="space-y-2">
          {tips.map((t, i) => { const I = TIP_ICON[t.tone]; return <div key={i} className="flex items-start gap-2.5 text-sm"><I className={cn("mt-0.5 h-4 w-4 shrink-0", TIP_CLS[t.tone])} />{t.text}</div>; })}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Section title="Where the money flows" className="lg:col-span-3">
          <Card className="p-3">
            {links.length ? (
              <Chart height={Math.max(320, Math.min(560, nodes.length * 34))} option={{ tooltip: { trigger: "item" },
                series: [{ type: "sankey", left: 4, right: 110, top: 8, bottom: 8, nodeGap: 14, emphasis: { focus: "adjacency" }, lineStyle: { color: "gradient", curveness: 0.5 }, label: { fontSize: 11 },
                  data: nodes.map((n) => ({ name: n, ...(NODE_COL[n] ? { itemStyle: { color: NODE_COL[n] } } : {}) })), links: links.map(([source, target, v]) => ({ source, target, value: rnd(v) })) }] }} />
            ) : <p className="p-4 text-sm text-muted">Add income and loans to see the flow.</p>}
          </Card>
        </Section>
        <Section title="Earned vs paid by person" className="lg:col-span-2">
          <Card className="p-3">
            {people.length ? (
              <Chart height={320} option={{ color: ["#10b981", "#4f46e5", "#f59e0b"], tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
                xAxis: { type: "category", data: names }, yAxis: { type: "value", axisLabel: { formatter: (v: number) => inrShort(v) } },
                series: [{ name: "Earned", type: "bar", data: people.map((p) => rnd(basis === "expected" ? p.expected : p.received)) },
                  { name: "Paid", type: "bar", data: people.map((p) => rnd(p.paid)) },
                  { name: "Left", type: "bar", data: people.map((p) => (p.person === "Not assigned" ? null : rnd(p.net))) }] }} />
            ) : <p className="p-4 text-sm text-muted">No payments marked yet - tick Paid and choose who paid.</p>}
          </Card>
        </Section>
      </div>

      <Section title="Who earned what and paid what">
        {people.length === 0 ? <Card className="text-sm text-muted">Nothing to show yet.</Card> : (<>
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-soft text-xs uppercase tracking-wide text-muted"><tr>{["Person", "Earns", "Received", "Paid: loans", "Paid: expenses", "Paid: extra", "Total paid", "Left (received - paid)"].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line tabular-nums">
                {people.map((p) => (
                  <tr key={p.person}><td className="px-3 py-3 font-medium">{p.person}</td><td className="px-3">{inr(p.expected)}</td><td className="px-3">{inr(p.received)}</td><td className="px-3">{inr(p.loans)}</td><td className="px-3">{inr(p.expenses)}</td><td className="px-3">{inr(p.extra)}</td>
                    <td className="px-3 font-semibold">{inr(p.paid)}</td><td className={cn("px-3 font-bold", p.net < 0 ? "text-bad" : "text-good")}>{p.person === "Not assigned" ? "-" : inr(p.net)}</td></tr>))}
              </tbody>
            </table>
          </Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {people.map((p) => (
              <Card key={p.person} className="space-y-1.5">
                <div className="flex items-center justify-between"><span className="font-semibold">{p.person}</span>
                  <span className={cn("font-bold tabular-nums", p.net < 0 ? "text-bad" : "text-good")}>{p.person === "Not assigned" ? "-" : inr(p.net)}</span></div>
                {([["Earns", p.expected], ["Received", p.received], ["Paid: loans", p.loans], ["Paid: expenses", p.expenses], ["Paid: extra", p.extra], ["Total paid", p.paid]] as [string, number][]).map(([l, v]) =>
                  <Line key={l} label={l}>{inr(v)}</Line>)}
              </Card>))}
          </div>
        </>)}
      </Section>

      <Section title="Income vs outgo over time">
        <Card className="p-3">
          <Chart height={300} option={{ color: ["#4f46e5", "#ef4444", "#f59e0b", "#10b981", "#0f172a"], tooltip: { trigger: "axis" }, legend: { top: 0, type: "scroll" }, grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
            xAxis: { type: "category", data: keys.map((k, i) => monthTitle(k) + (figs[i].estimated ? "*" : "")) }, yAxis: { type: "value", axisLabel: { formatter: (v: number) => inrShort(v) } },
            series: [{ name: "Loans", type: "bar", stack: "out", data: figs.map((x) => rnd(x.loans)) }, { name: "Expenses", type: "bar", stack: "out", data: figs.map((x) => rnd(x.expenses)) },
              { name: "Extra", type: "bar", stack: "out", data: figs.map((x) => rnd(x.extras)) }, { name: "Income", type: "line", smooth: true, data: figs.map((x) => rnd(x.income)) },
              { name: "Net", type: "line", smooth: true, lineStyle: { type: "dashed" }, data: figs.map((x) => rnd(x.income - x.loans - x.expenses - x.extras)) }] }} />
          <p className="mt-1 text-xs text-muted">* estimated (month not opened yet): uses your recurring income and schedules.</p>
        </Card>
      </Section>

      <ClaudeDialog open={ask} onClose={() => setAsk(false)} title="Income vs outgo - Claude's analysis"
        question={`Analyse income vs outgo for ${monthLong(month)}: who earns and pays what, is the split fair, how heavy are loan payments against income, and what to change next month. Use charts.`} />
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between text-sm"><span className="text-muted">{label}</span><span className="tabular-nums">{children}</span></div>;
}
