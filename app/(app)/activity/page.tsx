"use client";
import { useMemo, useState } from "react";
import { Banknote, CalendarCheck, Flag, Landmark, LineChart, Receipt, RotateCcw, Settings2, Undo2, Wallet } from "lucide-react";
import { useData } from "@/lib/app-context";
import type { ActivityEntry } from "@/lib/activity-types";
import { Badge, Button, Card, Dialog, Empty, PageHeader, Segmented } from "@/components/ui";

const ICONS: Record<string, typeof Landmark> = {
  setItemPaid: CalendarCheck, setItemsPaid: CalendarCheck, setPaidThrough: CalendarCheck,
  createEmiLoan: Landmark, createSimpleLoan: Landmark, createBulletLoan: Landmark, editLoan: Landmark, deleteLoan: Landmark,
  logPayment: Banknote, appendExtra: Banknote, applyPrepayment: Banknote, applySimpleExtra: Banknote,
  addIncome: Wallet, addRecurring: Wallet, setIncomeReceived: Wallet, append: Receipt, updateFlat: Receipt, deleteFlat: Receipt, setSetting: Settings2,
};

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o }).format(d);
  const mins = Math.round((Date.now() - +d) / 60000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : "";
  return `${fmt({ day: "2-digit", month: "short", year: "numeric" })}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: true })}${ago ? ` · ${ago}` : ""}`;
};

export default function ActivityPage() {
  const { tabs, act } = useData();
  const [filter, setFilter] = useState<"all" | "undoable" | "undone">("all");
  const [target, setTarget] = useState<ActivityEntry | null>(null);

  const all = useMemo(() => ([...(tabs.Activity as unknown as ActivityEntry[])]).sort((a, b) => (a.at < b.at ? 1 : -1)), [tabs.Activity]);
  const rows = all.filter((e) => (filter === "all" ? true : filter === "undoable" ? e.undoable : e.status === "undone")).slice(0, 200);

  const undo = async () => {
    if (!target) return;
    const id = target.id;
    setTarget(null);
    await act("undoActivity", { id }, { msg: "Undone - everything is back as it was", busy: "Undoing..." });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Activity log" subtitle="Every change made here is listed. Undo puts things back exactly as they were before that change." />
      <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${all.length})` }, { value: "undoable", label: "Can undo" }, { value: "undone", label: "Undone" }]} />

      {rows.length === 0 ? (
        <Empty icon={<LineChart />} title={all.length ? "Nothing in this view" : "No activity yet"}>
          {all.length ? "Try another filter." : "Ticking an EMI, adding an expense or applying a prepayment will show up here, with an Undo button."}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => {
            const I = ICONS[e.action] ?? Flag;
            const undone = e.status === "undone";
            return (
              <li key={e.id}>
                <Card className="flex items-center gap-3 p-3 sm:p-4">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${undone ? "bg-soft text-muted" : "bg-primary-soft text-primary"}`}><I className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium break-words ${undone ? "text-muted line-through" : ""}`}>{e.summary}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>{when(e.at)}</span>
                      {undone && <Badge tone="slate">Undone {e.undone_at ? when(e.undone_at).split(" · ")[0] : ""}</Badge>}
                      {!undone && !e.undoable && <Badge tone="slate">Can&apos;t be undone</Badge>}
                    </div>
                  </div>
                  {e.undoable && <Button variant="outline" size="sm" icon={<Undo2 className="h-4 w-4" />} onClick={() => setTarget(e)} aria-label={`Undo: ${e.summary}`}>Undo</Button>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!target} onClose={() => setTarget(null)} title="Undo this change?"
        footer={<><Button variant="ghost" onClick={() => setTarget(null)}>Keep it</Button><Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={undo}>Undo</Button></>}>
        <div className="space-y-2 pb-2 text-sm">
          <p className="font-medium">{target?.summary}</p>
          <p className="text-muted">The cells and entries this change touched go back to how they were. If they were edited again afterwards, nothing is changed and you&apos;ll be asked to undo the newer changes first.</p>
        </div>
      </Dialog>
    </div>
  );
}
