"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Flag, Image as ImageIcon, Landmark, Lightbulb, PiggyBank, Rocket, Sparkles, Users } from "lucide-react";
import { ClaudeDialog } from "@/components/answer";
import { MarkPaidDialog } from "@/components/mark-paid-dialog";
import { ReportDialog } from "@/components/month-report-dialog";
import { Badge, Button, Card, Chart, Empty, Kpi, PageHeader, Progress, Section, cn } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { diffDays, firstOfMonth, monthLong, nextMonth, today, monthKey } from "@/lib/dates";
import { dateLabel, inr, inrShort, monthsLabel } from "@/lib/format";
import { LOAN_TYPES, prepaymentEffect } from "@/lib/loans";
import { compareStrategies, monthlyBandwidth } from "@/lib/planner";
import { num, truthy, type Row } from "@/lib/state";

const sum = <T = Row,>(rows: T[], f: (r: T) => number = (r) => num((r as Row).amount)) => rows.reduce((s, r) => s + f(r), 0);
const isPaid = (r: Row) => r.paid === true || truthy(r.paid);

export default function Dashboard() {
  const { state, tabs, month, mk, isCurrent } = useData();
  const [plan, setPlan] = useState(false);
  const [report, setReport] = useState(false);

  const loans = state.activeLoans();
  const debts = state.debts();
  const items = tabs.MonthItems.filter((i) => i.month === mk);
  const loanItems = items.filter((i) => i.kind === "loan");
  const dues = sum(loanItems);
  const buffer = num(state.settings.emergency_buffer);
  const income = state.incomeThisMonth(mk, month <= firstOfMonth(today()));
  const bw = monthlyBandwidth(income, state.expensesTotal(mk), dues, buffer);
  const when = isCurrent ? "this month" : monthLong(month);
  const comp = debts.length ? compareStrategies(debts, bw.spare) : [];
  const best = comp.length ? [...comp].sort((a, b) => Number(a.months === null) - Number(b.months === null) || (a.months ?? 0) - (b.months ?? 0) || a.total_interest - b.total_interest)[0] : null;
  const totalOut = sum(debts, (d) => d.balance);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={monthLong(month)}
        actions={loans.length > 0 && <>
          <Button variant="outline" icon={<ImageIcon className="h-4 w-4" />} onClick={() => setReport(true)}>Download image</Button>
          <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setPlan(true)}>Ask Claude for this month&apos;s plan</Button></>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Total outstanding" value={inr(totalOut)} sub={`${loans.length} active loan${loans.length === 1 ? "" : "s"}`} icon={<Landmark />} />
        <Kpi label={`Due ${when}`} value={inr(dues)} sub="EMIs, interest & deadline savings" icon={<CalendarClock />} tone="warn" />
        <Kpi label="Household income" value={inr(bw.income)} sub={`fixed + received, ${when}`} icon={<Users />} tone="good" />
        <Kpi label={`Spare ${when}`} value={inr(bw.spare)} sub="after expenses, dues & buffer" icon={<PiggyBank />} tone={bw.spare > 0 ? "good" : "bad"} />
        <Kpi className="col-span-2 lg:col-span-1" label="Debt-free by" value={best ? dateLabel(best.debt_free_date) : "-"} sub={best ? `with ${inr(bw.spare)}/mo extra` : "add a loan to begin"} icon={<Flag />} tone="warn" />
      </div>

      {loans.length === 0 ? (
        <Empty icon={<Rocket />} title="Add your first loan to get started">Use the + button at the top to upload a repayment-schedule PDF or answer a few simple questions.</Empty>
      ) : (<>
        <PlanCard spare={bw.spare} bw={bw} onAsk={() => setPlan(true)} />
        <MonthCard />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Section title="Your loans" className="lg:col-span-3"><LoanList /></Section>
          <div className="space-y-6 lg:col-span-2">
            <Section title="Debt projection"><Projection comp={comp} /></Section>
            <Section title="Coming up"><Upcoming /></Section>
          </div>
        </div>
      </>)}
      <ClaudeDialog open={plan} onClose={() => setPlan(false)} />
      <ReportDialog open={report} onClose={() => setReport(false)} />
    </div>
  );
}

// ------------------------------------------------------------ bandwidth coach
function PlanCard({ spare, bw, onAsk }: { spare: number; bw: ReturnType<typeof monthlyBandwidth>; onAsk: () => void }) {
  const { state } = useData();
  const loans = state.activeLoans(), debts = state.debts().filter((d) => d.balance > 0);
  const target = spare > 0 && debts.length ? [...debts].sort((a, b) => b.rate - a.rate)[0] : null;
  const home = [...loans.filter((l) => l.type === "bank_emi")].sort((a, b) => state.outstanding(b) - state.outstanding(a))[0];
  const eff = target && home && num(home.emi) > 0 ? prepaymentEffect(state.outstanding(home), num(home.rate_pa), num(home.emi), spare, true) : null;
  return (
    <Card className="border-primary/20 bg-primary-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Lightbulb className="mt-0.5 h-7 w-7 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1">
            {target ? (<>
              <div className="text-lg font-semibold">You have {inr(spare)} of room this month.</div>
              <div className="text-sm text-muted">Highest-impact use: pay it toward {target.name} ({+target.rate.toFixed(2)}% - costliest debt).</div>
              {eff && eff.months_saved > 0 && <div className="text-sm font-medium text-good">If prepaid on {home.name}: finish {monthsLabel(eff.months_saved)} sooner and save about {inr(eff.interest_saved)} interest.</div>}
            </>) : (<>
              <div className="text-lg font-semibold">No spare room this month.</div>
              <div className="text-sm text-muted">Income {inr(bw.income)} - expenses {inr(bw.expenses)} - dues {inr(bw.dues)} = {inr(bw.surplus)}. Add income or trim expenses to start prepaying.</div>
            </>)}
          </div>
        </div>
        <Button variant="soft" className="shrink-0 border border-primary/30" icon={<Sparkles className="h-4 w-4" />} onClick={onAsk}>Ask Claude for this month&apos;s plan</Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ month at a glance + checklists
function Row2({ label, value, tone, bold }: { label: string; value: string; tone?: "good" | "bad"; bold?: boolean }) {
  return <div className={cn("flex justify-between gap-3 text-sm", bold && "font-semibold")}><span>{label}</span><span className={cn("tabular-nums", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</span></div>;
}
const Cap = ({ children }: { children: React.ReactNode }) => <div className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</div>;

function MonthCard() {
  const { state, tabs, month, mk } = useData();
  const nk = monthKey(nextMonth(month));
  const all = tabs.MonthItems.filter((i) => i.month === mk);
  const cur = all.filter((i) => i.kind === "loan"), expItems = all.filter((i) => i.kind === "expense");
  const nxt = tabs.MonthItems.filter((i) => i.month === nk && i.kind === "loan");
  const due = sum(cur), paidRows = cur.filter(isPaid), paid = sum(paidRows);
  const expDue = sum(expItems), expPaid = sum(expItems.filter(isPaid));
  const extras = sum(tabs.Extras.filter((e) => e.month === mk && truthy(e.applied)));
  const closed = sum(paidRows, (r) => num(r.principal)) + extras;
  const expPer = state.incomeByPerson(mk, false), recPer = state.receivedByPerson(mk);
  const income = sum(Object.values(expPer), (x) => x), received = sum(Object.values(recPer), (x) => x);
  const expenses = state.expensesTotal(mk);
  const leftIf = income - expenses - due - extras, leftNow = received - expPaid - paid - extras;
  const target = Math.max(sum(tabs.Recurring) - state.expensesTotal(nk) - sum(nxt) - num(state.settings.emergency_buffer), 0);
  const people = [...new Set([...state.persons(), ...Object.keys(expPer)])];
  const totalDue = due + expDue;
  const [item, setItem] = useState<Row | null>(null);

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{monthLong(month)} at a glance</h2>
          <div className="text-sm text-muted">EMIs {inr(paid)} / {inr(due)} paid · Expenses {inr(expPaid)} / {inr(expDue)} paid</div>
        </div>
        <Progress value={totalDue ? (paid + expPaid) / totalDue : 1} />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="space-y-1.5"><Cap>Income by person</Cap>
          {people.length === 0 && <div className="text-sm text-muted">No income added yet.</div>}
          {people.map((p) => <Row2 key={p} label={p} value={`${inr(recPer[p] || 0)} / ${inr(expPer[p] || 0)}`} />)}
          {people.length > 0 && <div className="text-xs text-muted">received / expected</div>}</div>
        <div className="space-y-1.5"><Cap>Where it goes</Cap>
          <Row2 label="Income expected" value={inr(income)} /><Row2 label="- Expenses" value={inr(expenses)} /><Row2 label="- EMIs due" value={inr(due)} /><Row2 label="- Extra payments" value={inr(extras)} />
          <div className="border-t border-line pt-1.5"><Row2 bold label="= Left this month" value={inr(leftIf)} tone={leftIf >= 0 ? "good" : "bad"} /></div>
          <div className="text-xs text-muted">Cash left right now (received - paid so far): {inr(leftNow)}</div></div>
        <div className="space-y-1.5"><Cap>Progress</Cap>
          <div className="text-sm font-medium">Debt closed this month: {inr(closed)}</div>
          <div className="text-sm">Still to pay this month: {inr(due - paid)}</div>
          <div className="text-sm">Remaining overall: {inr(sum(state.debts(), (d) => d.balance))}</div>
          <div className="border-t border-line pt-1.5"><Cap>Next month&apos;s target</Cap>
            <div className="mt-1 text-sm font-medium text-primary">EMIs {inr(sum(nxt))} - you can add up to {inr(target)} extra</div></div></div>
      </div>
      {cur.length > 0 && <Checklist title={`${monthLong(month).split(" ")[0]} - loan payments`} rows={cur} onTick={setItem} />}
      {expItems.length > 0 && <Checklist title={`${monthLong(month).split(" ")[0]} - expenses`} rows={expItems} onTick={setItem} />}
      {cur.length === 0 && expItems.length === 0 && <div className="border-t border-line pt-3 text-sm text-muted">Nothing is scheduled for this month yet.</div>}
      <MarkPaidDialog item={item} onClose={() => setItem(null)} />
    </Card>
  );
}

function Checklist({ title, rows, onTick }: { title: string; rows: Row[]; onTick: (r: Row) => void }) {
  const { act } = useData();
  return (
    <div className="border-t border-line pt-3">
      <Cap>{title}</Cap>
      <ul className="mt-1 divide-y divide-line">
        {rows.map((r) => {
          const carried = String(r.ref).startsWith("carry:"), paid = isPaid(r), overdue = carried && !paid;
          const id = `chk-${r.tab}-${r.row}`;
          return (
            <li key={String(r.ref)} className={cn("flex items-center gap-3 px-1 sm:px-2", overdue && "my-0.5 rounded-lg bg-bad-soft text-bad")}>
              <input id={id} type="checkbox" checked={paid} className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                onChange={(e) => { if (e.target.checked) onTick(r); else void act("setItemPaid", { tab: r.tab, row: r.row, paid: false }, { msg: "Marked as not paid", busy: "Updating payment..." }); }} />
              <label htmlFor={id} className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col justify-center py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className={cn("min-w-0 text-sm", paid && "text-muted line-through")}>
                  <span className="font-medium">{r.loan}</span> - {r.label}
                  <span className="text-muted"> · due {r.due}</span>
                  {overdue && <Badge tone="bad" className="ml-2">Overdue</Badge>}
                </span>
                <span className="text-sm font-semibold tabular-nums">{inr(num(r.amount))}</span>
              </label>
            </li>);
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ loans, projection, upcoming
function LoanList() {
  const { state } = useData();
  const loans = [...state.activeLoans()].sort((a, b) => state.outstanding(b) - state.outstanding(a));
  return (
    <div className="space-y-3">
      {loans.map((l) => {
        const out = state.outstanding(l), principal = num(l.principal) || out;
        const pct = principal ? Math.max(0, Math.min(1, 1 - out / principal)) : 0;
        const [due, amt] = state.nextDue(l), total = num(l.tenure_months);
        return (
          <Link key={l.id} href="/loans" className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-primary">
            <Card className="space-y-2 transition hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate font-semibold">{l.name}</div>
                  <div className="truncate text-xs text-muted">{l.lender} · {l.owner || "unassigned"} · {LOAN_TYPES[l.type] ?? l.type}</div></div>
                <div className="shrink-0 text-right"><div className="text-lg font-bold tabular-nums">{inr(out)}</div><div className="text-xs text-muted">outstanding</div></div>
              </div>
              <Progress value={pct} tone="indigo" />
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
                <span>{Math.round(pct * 100)}% repaid{total ? ` · ${state.paidCount(l.id)}/${Math.trunc(total)} EMIs` : ""}</span>
                <span>{due ? `Next: ${inr(amt)} on ${dateLabel(due)}` : `Monthly: ${inr(state.monthlyDue(l))}`}</span>
              </div>
            </Card>
          </Link>);
      })}
    </div>
  );
}

function Projection({ comp }: { comp: ReturnType<typeof compareStrategies> }) {
  if (!comp.length) return <Card className="text-sm text-muted">Add a loan to see the projection.</Card>;
  const n = Math.max(...comp.map((c) => c.timeline.length));
  const idx = Array.from({ length: Math.ceil(n / 3) }, (_, i) => i * 3);
  return (
    <Card className="p-3">
      <Chart height={260} option={{ tooltip: { trigger: "axis" }, legend: { top: 0 }, grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
        xAxis: { type: "category", name: "months", nameLocation: "middle", nameGap: 26, data: idx },
        yAxis: { type: "value", axisLabel: { formatter: (v: number) => inrShort(v) } },
        series: comp.map((c) => ({ name: c.strategy[0].toUpperCase() + c.strategy.slice(1), type: "line", smooth: true, showSymbol: false, data: idx.map((i) => c.timeline[i] ?? 0) })) }} />
      <p className="mt-1 text-xs text-muted">Avalanche = highest interest first; snowball = smallest balance first; deadline = nearest due date first.</p>
    </Card>
  );
}

function Upcoming() {
  const { state } = useData();
  const t = today();
  const up = state.activeLoans().map((l) => { const [d, amt] = state.nextDue(l); return d ? { d, name: String(l.name), amt } : null; }).filter((x): x is { d: string; name: string; amt: number } => !!x)
    .sort((a, b) => a.d.localeCompare(b.d)).slice(0, 6);
  if (!up.length) return <Card className="text-sm text-muted">Nothing coming up.</Card>;
  return (
    <Card className="divide-y divide-line p-0">
      {up.map((u, i) => {
        const days = diffDays(u.d, t);
        const tone = days < 0 ? "bad" : days <= 5 ? "warn" : "slate";
        return (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{u.name}</div><div className="text-xs text-muted">{dateLabel(u.d)}</div></div>
            <div className="shrink-0 text-right"><div className="text-sm font-semibold tabular-nums">{inr(u.amt)}</div>
              <Badge tone={tone}>{days < 0 ? `overdue ${-days}d` : days === 0 ? "today" : `in ${days}d`}</Badge></div>
          </div>);
      })}
    </Card>
  );
}
