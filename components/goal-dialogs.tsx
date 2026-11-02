"use client";
/** Goal add/edit, delete and "mark saved" dialogs (app.py goal_dialog / delete_goal / saved_dialog), plus shared helpers
 *  used by the Expenses, Goals and Finance pages (monthFigures = app.py::month_figures, ConfirmDialog, newId). */
import { useState, type ReactNode } from "react";
import { Button, Dialog, Field, Input, NumberInput, Select } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { monthKey, monthsBetween, parseDate } from "@/lib/dates";
import { inr } from "@/lib/format";
import { Row, State, num, truthy } from "@/lib/state";

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

export interface MonthFigures { income: number; loans: number; expenses: number; extras: number; estimated: boolean }

/** Income and outgo for any month: from its tab when it exists, otherwise estimated from schedules and settings. */
export function monthFigures(state: State, key: string): MonthFigures {
  const t = state.tabs;
  const mine = t.MonthItems.filter((i) => i.month === key);
  const hasTab = mine.length > 0 || t.Income.some((i) => i.month === key);
  const recIncome = t.Recurring.reduce((s, r) => s + num(r.amount), 0);
  const income = hasTab ? state.incomeThisMonth(key, false) : recIncome;
  let loans: number;
  if (mine.length) loans = mine.filter((i) => i.kind === "loan").reduce((s, i) => s + num(i.amount), 0);
  else {
    loans = 0;
    for (const l of state.activeLoans()) {
      const sch = state.schedule(l.id);
      if (sch.length) loans += sch.filter((r) => { const d = parseDate(r.due_date); return d && monthKey(d) === key; }).reduce((s, r) => s + num(r.emi), 0);
      else {
        const first = parseDate(l.first_due_date);
        if (first && monthsBetween(first, `${key}-01`) < 0) continue;
        if (l.type === "interest_free_deadline" || l.type === "bullet") { const d = parseDate(l.deadline); if (!d || monthKey(d) !== key) continue; }
        loans += state.monthlyDue(l);
      }
    }
  }
  const extras = t.Extras.filter((e) => e.month === key && truthy(e.applied)).reduce((s, e) => s + num(e.amount), 0);
  return { income, loans, expenses: state.expensesTotal(key), extras, estimated: !hasTab };
}

export function usePayers() {
  const { state } = useData();
  const people = state.persons().length ? state.persons() : ["Me"];
  return { people, payers: [...people, "Joint"] };
}

export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = "Delete" }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; children?: ReactNode; confirmLabel?: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></>}>
      <div className="pb-2 text-sm text-muted">{children}</div>
    </Dialog>
  );
}

export function GoalDialog({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Row | null }) {
  return open ? <GoalForm onClose={onClose} goal={goal} /> : null;
}

function GoalForm({ onClose, goal }: { onClose: () => void; goal: Row | null }) {
  const open = true;
  const { act } = useData();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState<number | null>(goal ? num(goal.target) : null);
  const [saved, setSaved] = useState<number | null>(goal ? num(goal.saved) : 0);
  const [pct, setPct] = useState<number | null>(goal ? num(goal.percent) : 0);
  const [by, setBy] = useState(goal ? String(goal.target_date ?? "") : "");
  const [note, setNote] = useState(goal?.note ?? "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim() || !(target && target > 0)) return setErr("Fill goal name and target");
    if ((pct ?? 0) < 0 || (pct ?? 0) > 100) return setErr("Share must be between 0 and 100");
    setErr(""); setSaving(true);
    const vals = { name: name.trim(), target, saved: saved ?? 0, percent: pct ?? 0, target_date: by, note, id: goal && String(goal.id ?? "").trim() ? String(goal.id) : newId() };
    if (goal) await act("updateFlat", { tab: "Goals", row: Number(goal.row), vals }, { msg: "Goal updated", busy: "Saving goal..." });
    else await act("append", { tab: "Goals", row: vals }, { msg: "Goal added", busy: "Adding goal..." });
    setSaving(false); onClose();
  }
  return (
    <Dialog open={open} onClose={onClose} title={goal ? "Edit goal" : "Add goal"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Goal (Emergency fund, Car, Trip...)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Target amount"><NumberInput value={target} onChange={setTarget} prefix="₹" /></Field>
          <Field label="Already saved"><NumberInput value={saved} onChange={setSaved} prefix="₹" /></Field>
        </div>
        <Field label="Share of monthly savings" hint="Out of 100 across all goals"><NumberInput value={pct} onChange={setPct} suffix="%" /></Field>
        <Field label="Target date (optional, e.g. 2027-06)"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function DeleteGoalDialog({ goal, onClose }: { goal: Row | null; onClose: () => void }) {
  const { act } = useData();
  return (
    <ConfirmDialog open={!!goal} onClose={onClose} title={`Delete goal '${goal?.name ?? ""}'?`}
      onConfirm={() => goal && void act("deleteFlat", { tab: "Goals", row: Number(goal.row) }, { msg: "Goal deleted", busy: "Deleting goal..." })}>
      Its saved-money log entries stay in the Savings Log tab.
    </ConfirmDialog>
  );
}

/** Log money actually put aside for a goal in the selected month. */
export function SavedDialog({ goal, suggested, onClose }: { goal: Row | null; suggested: number; onClose: () => void }) {
  return goal ? <SavedForm goal={goal} suggested={suggested} onClose={onClose} /> : null;
}

function SavedForm({ goal: g, suggested, onClose }: { goal: Row; suggested: number; onClose: () => void }) {
  const goal: Row | null = g;
  const { act, mk } = useData();
  const { payers } = usePayers();
  const [amt, setAmt] = useState<number | null>(Math.round(suggested) || null);
  const [who, setWho] = useState(payers[0]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!amt) return setErr("Enter an amount");
    setSaving(true);
    await act("append", { tab: "Savings Log", row: { month: mk, goal_id: goal!.id, amount: amt, by: who, note, id: newId() } }, { msg: `Saved ${inr(amt)} for ${goal!.name}`, busy: "Recording saving..." });
    setSaving(false); onClose();
  }
  return (
    <Dialog open={!!goal} onClose={onClose} title={`Saved for ${goal?.name ?? ""}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="How much did you save?"><NumberInput value={amt} onChange={setAmt} prefix="₹" autoFocus /></Field>
        <Field label="By whom"><Select value={who} onChange={(e) => setWho(e.target.value)}>{payers.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
