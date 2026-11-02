"use client";
import { useState } from "react";
import { Check, Flag, PieChart, Pencil, PiggyBank, Plus, Trash2, Wallet } from "lucide-react";
import { Button, Card, Chart, Empty, Field, Kpi, KpiGrid, NumberInput, PageHeader, Progress, Section } from "@/components/ui";
import { DeleteGoalDialog, GoalDialog, SavedDialog, monthFigures } from "@/components/goal-dialogs";
import { useData } from "@/lib/app-context";
import { monthLong } from "@/lib/dates";
import { inr } from "@/lib/format";
import { Row, num } from "@/lib/state";

export default function GoalsPage() {
  const { state, month, mk } = useData();
  const [edit, setEdit] = useState<{ goal: Row | null } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [saved, setSaved] = useState<{ goal: Row; suggested: number } | null>(null);
  const [poolOverride, setPool] = useState<{ mk: string; v: number | null } | null>(null);

  const f = monthFigures(state, mk);
  const buffer = num(state.settings.emergency_buffer);
  const left = f.income - f.expenses - f.loans - f.extras;
  const suggested = Math.max(left - buffer, 0);
  const pool = poolOverride && poolOverride.mk === mk && poolOverride.v != null ? poolOverride.v : suggested;
  const custom = poolOverride?.mk === mk && poolOverride.v != null;
  const goals = state.goals();
  const totalPct = goals.reduce((s, g) => s + g.percent, 0);
  const allocated = Math.round(totalPct * 100) / 100 === 100;
  const pieData = goals.filter((g) => g.percent > 0).map((g) => ({ name: g.name, value: Math.round((pool * g.percent) / 100) }));

  return (
    <div className="space-y-6">
      <PageHeader title={`Goals & savings - ${monthLong(month)}`} subtitle="Give each goal a share out of 100. Each month you see how much to put aside for it."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ goal: null })}>Add goal</Button>} />
      <KpiGrid>
        <Kpi label="Left this month" value={inr(left)} sub={`income - expenses - EMIs${f.estimated ? " (estimated)" : ""}`} icon={<PiggyBank />} tone={left >= 0 ? "good" : "bad"} />
        <Kpi label="Safe to save" value={inr(suggested)} sub={`after the ${inr(buffer)} emergency buffer`} icon={<Wallet />} />
        <Kpi label="Shares used" value={`${+totalPct.toFixed(2)} / 100`} sub={allocated ? "all of it is allocated" : "adjust shares so they total 100"} icon={<PieChart />} tone={allocated ? "good" : "warn"} />
        <Kpi label="Saved in total" value={inr(goals.reduce((s, g) => s + g.saved_total, 0))} sub={`across ${goals.length} goal${goals.length === 1 ? "" : "s"}`} icon={<Flag />} />
      </KpiGrid>

      <Card className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Amount to split this month" className="w-full sm:w-56">
            <NumberInput value={Math.round(pool)} prefix="₹" onChange={(v) => setPool({ mk, v: v ?? 0 })} />
          </Field>
          {custom && <Button variant="soft" size="sm" onClick={() => setPool(null)}>Use suggested ({inr(suggested)})</Button>}
        </div>
        <p className="text-xs text-muted">Starts at what is left after EMIs, expenses and your buffer. Change it if you plan to save more or less.</p>
      </Card>

      {goals.length === 0 ? (
        <Empty icon={<Flag />} title="No goals yet" action={<Button onClick={() => setEdit({ goal: null })}>Add your first goal</Button>}>
          For example Emergency fund 40%, Car 30%, Trip 30%.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            {goals.map((g) => {
              const share = (pool * g.percent) / 100;
              const done = g.saved_total;
              const thisMonth = state.savedInMonth(g.id, mk);
              const remaining = Math.max(g.target - done, 0);
              const months = remaining && share > 0 ? Math.ceil(remaining / share) : 0;
              return (
                <Card key={g.row} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="min-w-0 truncate text-lg font-semibold">{g.name}</h3>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${g.name}`} onClick={() => setEdit({ goal: g })}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${g.name}`} onClick={() => setDel(g)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <Progress value={g.target ? Math.min(done / g.target, 1) : 0} />
                  <p className="text-sm text-muted">{inr(done)} of {inr(g.target)} saved - {inr(remaining)} to go</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-primary">Save this month: {inr(share)}</div>
                      <div className="text-xs text-muted">{+g.percent.toFixed(2)}% of {inr(pool)}{thisMonth ? ` - already saved ${inr(thisMonth)}` : ""}</div>
                    </div>
                    <Button variant="soft" size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setSaved({ goal: g, suggested: Math.max(share - thisMonth, 0) })}>Mark saved</Button>
                  </div>
                  {remaining > 0 && months > 0 && <p className="text-xs text-muted">At this pace: about {months} month{months === 1 ? "" : "s"} to reach it{String(g.target_date ?? "").trim() ? ` (target ${g.target_date})` : ""}</p>}
                  {remaining === 0 && <p className="text-xs font-medium text-good">Goal reached</p>}
                </Card>
              );
            })}
          </div>
          <div className="lg:col-span-2">
            <Section title="Split of this month's savings">
              <Card>
                {pieData.length && pool > 0 ? (
                  <Chart height={280} option={{ tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 },
                    series: [{ type: "pie", radius: ["42%", "66%"], center: ["50%", "44%"], label: { show: false }, data: pieData }] }} />
                ) : <p className="py-6 text-center text-sm text-muted">Nothing to split this month.</p>}
              </Card>
            </Section>
          </div>
        </div>
      )}
      <GoalDialog open={!!edit} onClose={() => setEdit(null)} goal={edit?.goal ?? null} />
      <DeleteGoalDialog goal={del} onClose={() => setDel(null)} />
      <SavedDialog goal={saved?.goal ?? null} suggested={saved?.suggested ?? 0} onClose={() => setSaved(null)} />
    </div>
  );
}
