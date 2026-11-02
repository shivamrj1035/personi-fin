"use client";
import { useState } from "react";
import { Plus, Users, User, Wallet } from "lucide-react";
import { Badge, Button, Card, Checkbox, Empty, Kpi, KpiGrid, PageHeader, Section } from "@/components/ui";
import { IncomeDialog } from "@/components/income-dialog";
import { useData } from "@/lib/app-context";
import { monthLong } from "@/lib/dates";
import { inr } from "@/lib/format";
import { num, truthy } from "@/lib/state";

export default function IncomePage() {
  const { state, month, mk, act } = useData();
  const [adding, setAdding] = useState(false);
  const expected = state.incomeByPerson(mk, false);
  const received = state.receivedByPerson(mk);
  const rows = state.tabs.Income.filter((r) => r.month === mk);
  const people = Array.from(new Set([...state.persons(), ...Object.keys(expected)]));
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const pending = sum(expected) - sum(received);

  const toggle = (r: (typeof rows)[number], value: boolean) =>
    act("setIncomeReceived", { tab: r.tab, row: Number(r.row), value }, { busy: "Updating income...", msg: value ? "Marked received" : "Marked not received" });

  return (
    <div className="space-y-6">
      <PageHeader title={`Income - ${monthLong(month)}`} subtitle="Tick Received when the money arrives. Use the month picker to see any other month."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add income</Button>} />
      <KpiGrid>
        <Kpi label="Household income" value={inr(sum(expected))} sub={`${inr(sum(received))} received so far`} icon={<Users />} tone="good" />
        <Kpi label="Still to come" value={inr(Math.max(pending, 0))} sub={pending > 0 ? "not yet ticked received" : "everything received"} icon={<Wallet />} tone={pending > 0 ? "warn" : "good"} />
        {people.map((p) => <Kpi key={p} label={p} value={inr(expected[p] || 0)} sub={`${inr(received[p] || 0)} received`} icon={<User />} />)}
      </KpiGrid>

      <Section title="Income this month">
        {rows.length === 0 ? (
          <Empty icon={<Wallet />} title="No income for this month yet" action={<Button onClick={() => setAdding(true)}>Add income</Button>}>
            Add a fixed income (repeats every month) or a one-off amount for {monthLong(month)}.
          </Empty>
        ) : (
          <Card className="divide-y divide-line p-0">
            {rows.map((r) => {
              const got = truthy(r.received);
              return (
                <div key={`${r.tab}|${r.row}`} className="flex items-center gap-3 px-4 py-2">
                  <Checkbox checked={got} onChange={(v) => toggle(r, v)} label={<span className="sr-only">{r.source} from {r.person} received</span>} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.source || "Income"}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{r.person}</span>
                      <Badge tone={r.type === "fixed" ? "indigo" : "slate"}>{r.type === "fixed" ? "Fixed" : "Variable"}</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{inr(num(r.amount))}</div>
                    <Badge tone={got ? "good" : "warn"}>{got ? "Received" : "Pending"}</Badge>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </Section>
      <IncomeDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
