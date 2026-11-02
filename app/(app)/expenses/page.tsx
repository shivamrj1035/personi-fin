"use client";
import { useMemo, useState } from "react";
import { CalendarDays, PiggyBank, Pencil, PieChart, Plus, Receipt, Repeat, Trash2 } from "lucide-react";
import { Button, Card, Chart, Checkbox, Empty, Kpi, KpiGrid, PageHeader, Section } from "@/components/ui";
import { AddToMonthDialog } from "@/components/add-to-month-dialog";
import { ExpenseEditDialog, appliesLabel, expenseMonths } from "@/components/expense-edit-dialog";
import { ConfirmDialog, monthFigures } from "@/components/goal-dialogs";
import { MarkPaidDialog } from "@/components/mark-paid-dialog";
import { useData } from "@/lib/app-context";
import { addMonths, monthLong } from "@/lib/dates";
import { inr, inrShort } from "@/lib/format";
import { Row, num, truthy } from "@/lib/state";

export default function ExpensesPage() {
  const { state, month, mk, act } = useData();
  const [edit, setEdit] = useState<{ row: Row | null } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [pay, setPay] = useState<Row | null>(null);
  const [addLoan, setAddLoan] = useState(false);

  const this_ = state.expensesFor(mk);
  const inIds = new Set(this_.map((r) => r.row));
  const others = state.tabs.Expenses.filter((r) => !inIds.has(r.row));
  const recurring = this_.filter((r) => !expenseMonths(r).length);
  const pinned = this_.filter((r) => expenseMonths(r).length);
  const total = this_.reduce((s, r) => s + num(r.amount), 0);
  const items = state.tabs.MonthItems.filter((i) => i.month === mk);
  const emis = items.filter((i) => i.kind === "loan").reduce((s, i) => s + num(i.amount), 0);
  const expItems = new Map(items.filter((i) => i.kind === "expense").map((i) => [String(i.ref).split("|")[0], i]));
  const paidTotal = [...expItems.values()].filter((i) => truthy(i.paid)).reduce((s, i) => s + num(i.amount), 0);
  const income = state.incomeThisMonth(mk, false);
  const left = income - total - emis;

  const catTotals: Record<string, number> = {};
  for (const r of this_) { const c = r.category || "Other"; catTotals[c] = (catTotals[c] || 0) + num(r.amount); }
  const byCat = Object.entries(catTotals).map(([name, value]) => ({ name, value: Math.round(value) }));

  const series = useMemo(() => {
    const keys = Array.from({ length: 9 }, (_, i) => addMonths(month, i - 3).slice(0, 7));
    const figs = keys.map((k) => monthFigures(state, k));
    return { labels: keys.map((k) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" })), figs };
  }, [state, month]);

  const renderRow = (r: Row) => {
    const item = expItems.get(`exp:${r.id}`);
    return (
      <div key={r.row} className="flex items-center gap-2 px-3 py-2">
        {item && (
          <Checkbox checked={truthy(item.paid)} onChange={(v) => (v ? setPay(item) : void act("setItemPaid", { tab: item.tab, row: Number(item.row), paid: false }, { busy: "Updating payment...", msg: "Marked unpaid" }))}
            label={<span className="sr-only">{r.name} paid</span>} className="shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{r.name}</div>
          <div className="truncate text-xs text-muted">{r.category || "Other"} · {r.owner || "Household"} · {appliesLabel(r)}{r.note ? ` · ${r.note}` : ""}</div>
        </div>
        <div className="font-semibold tabular-nums">{inr(num(r.amount))}</div>
        <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setEdit({ row: r })}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /></Button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`Expenses - ${monthLong(month)}`} subtitle="Rent, bills and other costs. Tracked for analysis - your main goal stays clearing EMIs."
        actions={<><Button variant="outline" onClick={() => setAddLoan(true)}>Record EMI payment</Button><Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ row: null })}>Add expense</Button></>} />
      <KpiGrid className="lg:grid-cols-5">
        <Kpi label="Total this month" value={inr(total)} sub={`${inr(paidTotal)} paid - tick each when done`} icon={<Receipt />} tone="bad" />
        <Kpi label="Every month" value={inr(recurring.reduce((s, r) => s + num(r.amount), 0))} sub={`${recurring.length} recurring`} icon={<Repeat />} />
        <Kpi label="Only this month" value={inr(pinned.reduce((s, r) => s + num(r.amount), 0))} sub={`${pinned.length} one-off / specific`} icon={<CalendarDays />} />
        <Kpi label="Share of income" value={income ? `${Math.round((total / income) * 100)}%` : "-"} sub={`of ${inr(income)}`} icon={<PieChart />} tone="warn" />
        <Kpi label="Left after EMIs" value={inr(left)} sub={`income - expenses - ${inr(emis)} EMIs`} icon={<PiggyBank />} tone={left >= 0 ? "good" : "bad"} className="col-span-2 lg:col-span-1" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Section title="This month">
            {this_.length ? (
              <Card className="divide-y divide-line p-0">{[...this_].sort((a, b) => num(b.amount) - num(a.amount)).map((r) => renderRow(r))}</Card>
            ) : (
              <Empty icon={<Receipt />} title="No expenses for this month yet" action={<Button onClick={() => setEdit({ row: null })}>Add expense</Button>}>Add rent, bills or anything you spend regularly.</Empty>
            )}
          </Section>
          {others.length > 0 && (
            <Section title="Other months">
              <p className="-mt-2 text-xs text-muted">Expenses that apply only to different months.</p>
              <Card className="divide-y divide-line p-0">{others.map((r) => renderRow(r))}</Card>
            </Section>
          )}
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Section title="Where it goes">
            <Card>
              {byCat.length ? (
                <Chart height={260} option={{ tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 },
                  series: [{ type: "pie", radius: ["42%", "66%"], center: ["50%", "44%"], label: { show: false }, data: byCat }] }} />
              ) : <p className="py-6 text-center text-sm text-muted">Add an expense to see the breakdown.</p>}
            </Card>
          </Section>
          <Section title="Month by month">
            <Card>
              <Chart height={260} option={{ color: ["#ef4444", "#4f46e5", "#10b981"], tooltip: { trigger: "axis" }, legend: { top: 0 },
                grid: { left: 52, right: 12, top: 36, bottom: 28 }, xAxis: { type: "category", data: series.labels },
                yAxis: { type: "value", axisLabel: { formatter: (v: number) => inrShort(v) } },
                series: [{ name: "Expenses", type: "bar", stack: "out", data: series.figs.map((f) => Math.round(f.expenses)) },
                  { name: "EMIs", type: "bar", stack: "out", data: series.figs.map((f) => Math.round(f.loans)) },
                  { name: "Income", type: "line", smooth: true, data: series.figs.map((f) => Math.round(f.income)) }] }} />
              <p className="mt-2 text-xs text-muted">Bars stack expenses and EMIs; the line is income. Gaps show months you can put extra toward EMIs.</p>
            </Card>
          </Section>
        </div>
      </div>

      <ExpenseEditDialog open={!!edit} onClose={() => setEdit(null)} expense={edit?.row ?? null} />
      <AddToMonthDialog open={addLoan} onClose={() => setAddLoan(false)} mode="loan" />
      <MarkPaidDialog item={pay} onClose={() => setPay(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete '${del?.name ?? ""}'?`}
        onConfirm={() => del && void act("deleteFlat", { tab: "Expenses", row: Number(del.row) }, { msg: "Expense deleted", busy: "Deleting expense..." })}>
        {del ? `${inr(num(del.amount))} - ${appliesLabel(del)}` : ""}
      </ConfirmDialog>
    </div>
  );
}
