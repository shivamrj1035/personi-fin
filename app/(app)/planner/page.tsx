"use client";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Card, Chart, Empty, Field, NumberInput, PageHeader, Section } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { dateLabel, inr, inrShort, monthsLabel } from "@/lib/format";
import { compareStrategies, monthlyBandwidth } from "@/lib/planner";
import { num } from "@/lib/state";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function PlannerPage() {
  const { state } = useData();
  const debts = useMemo(() => state.debts(), [state]);
  const bw = monthlyBandwidth(state.incomeThisMonth(), state.expensesTotal(), debts.reduce((s, d) => s + d.min_payment, 0), num(state.settings.emergency_buffer));
  const [extra, setExtra] = useState<number | null>(Math.round(bw.spare));
  const x = Math.max(extra ?? 0, 0);
  const comp = useMemo(() => (debts.length ? compareStrategies(debts, x) : []), [debts, x]);
  const base = useMemo(() => (debts.length ? compareStrategies(debts, 0)[0] : null), [debts]);

  if (!debts.length || !base) return <div className="space-y-4"><PageHeader title="Payoff planner" /><Empty title="Add a loan first">The planner compares payoff strategies once you have an active loan.</Empty></div>;

  const n = Math.max(...comp.map((c) => c.timeline.length), base.timeline.length);
  const idx = Array.from({ length: Math.ceil(n / 3) }, (_, i) => i * 3);
  const line = (name: string, data: number[], dashed = false) => ({ name, type: "line", showSymbol: false, smooth: true, ...(dashed ? { lineStyle: { type: "dashed" } } : {}), data: idx.map((i) => data[i] ?? 0) });
  const order = Object.entries(comp[0].payoff_month).sort((a, b) => a[1] - b[1]);

  return (
    <div className="space-y-6">
      <PageHeader title="Payoff planner" subtitle="Compare ways to clear your debts and see what extra payments are worth." />
      <Card className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Extra per month toward debt" className="sm:w-72"><NumberInput value={extra} onChange={setExtra} prefix="₹" aria-label="Extra per month toward debt" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => setExtra(Math.round(bw.spare))}>Use spare ({inr(bw.spare)})</Button>
            <Button size="sm" variant="outline" onClick={() => setExtra(0)}>Minimums only</Button>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Spare this month is {inr(bw.spare)} (after dues, expenses and {inr(bw.buffer)} buffer).</p>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {comp.map((c) => (
          <Card key={c.strategy} className="space-y-0.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{cap(c.strategy)}</div>
            <div className="text-xl font-bold">{dateLabel(c.debt_free_date)}</div>
            <div className="text-sm">{monthsLabel(c.months)} - interest {inr(c.total_interest)}</div>
            <div className="text-xs text-good">saves {inr(base.total_interest - c.total_interest)} vs minimums only</div>
          </Card>))}
      </div>

      <Card className="p-3">
        <Chart height={320} option={{ tooltip: { trigger: "axis" }, legend: { top: 0, type: "scroll" }, grid: { left: 8, right: 12, top: 40, bottom: 8, containLabel: true },
          xAxis: { type: "category", name: "months", nameLocation: "middle", nameGap: 26, data: idx }, yAxis: { type: "value", axisLabel: { formatter: (v: number) => inrShort(v) } },
          series: [...comp.map((c) => line(cap(c.strategy), c.timeline)), line("Minimums only", base.timeline, true)] }} />
        <p className="mt-1 text-xs text-muted">Avalanche = highest interest first; snowball = smallest balance first; deadline = nearest due date first.</p>
      </Card>

      <Section title="Payoff order (avalanche)">
        <Card className="divide-y divide-line p-0">
          {order.length === 0 && <div className="p-4 text-sm text-muted">Nothing is cleared within the simulated period.</div>}
          {order.map(([id, m], i) => (
            <div key={id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span><span className="truncate font-medium">{debts.find((d) => d.id === id)?.name}</span></span>
              <span className="shrink-0 text-muted">cleared in {monthsLabel(m)}</span>
            </div>))}
        </Card>
      </Section>
    </div>
  );
}
