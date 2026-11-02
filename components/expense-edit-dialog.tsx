"use client";
/** Add (expense=null) or edit a household expense: rent, utilities... every month or only chosen months. (app.py::expense_edit_dialog) */
import { useMemo, useState } from "react";
import { Button, Dialog, Field, Input, NumberInput, Segmented, Select, cn } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { MONTHS_SHORT, addMonths } from "@/lib/dates";
import { newId } from "@/components/goal-dialogs";
import { Row, num } from "@/lib/state";

export const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Groceries", "School fees", "Insurance", "Subscriptions", "Transport", "Medical", "Family", "Other"];
export const monthLabel = (k: string) => { const m = /^(\d{4})-(\d{2})$/.exec(k); return m ? `${MONTHS_SHORT[+m[2] - 1]} ${m[1]}` : k; };
export const expenseMonths = (r: Row): string[] => String(r.month ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const appliesLabel = (r: Row) => { const m = expenseMonths(r); return m.length ? m.map(monthLabel).join(", ") : "Every month"; };

export function ExpenseEditDialog({ open, onClose, expense }: { open: boolean; onClose: () => void; expense: Row | null }) {
  return open ? <ExpenseForm onClose={onClose} expense={expense} /> : null;
}

function ExpenseForm({ onClose, expense }: { onClose: () => void; expense: Row | null }) {
  const open = true;
  const { state, act, month, mk } = useData();
  const r = expense;
  const cur = r ? expenseMonths(r) : [mk];
  const owners = useMemo(() => ["Household", ...(state.persons().length ? state.persons() : ["Me"])], [state]);
  const [name, setName] = useState(r?.name ?? "");
  const [cat, setCat] = useState(r ? r.category || "Other" : "Rent");
  const [amt, setAmt] = useState<number | null>(r ? num(r.amount) : null);
  const [owner, setOwner] = useState(r && owners.includes(r.owner) ? r.owner : "Household");
  const [scope, setScope] = useState<"all" | "some">(r && cur.length ? "some" : "all");
  const [months, setMonths] = useState<string[]>(cur.length ? cur : [mk]);
  const [day, setDay] = useState<number | null>(r ? Math.trunc(num(r.day)) || 1 : 1);
  const [note, setNote] = useState(r?.note ?? "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const cats = useMemo(() => Array.from(new Set([...EXPENSE_CATEGORIES, ...(cat ? [cat] : [])])), [cat]);
  const monthOpts = useMemo(() => {
    const s = new Set<string>();
    for (let i = -2; i <= 12; i++) s.add(addMonths(month, i).slice(0, 7));
    months.forEach((m) => s.add(m));
    return Array.from(s).sort();
  }, [month, months]);

  async function save() {
    if (!name.trim() || !(amt && amt > 0)) return setErr("Fill name and amount");
    if (scope === "some" && !months.length) return setErr("Pick at least one month");
    setErr(""); setSaving(true);
    const vals = { name: name.trim(), owner, category: cat || "Other", amount: amt, note, month: scope === "all" ? "" : [...months].sort().join(","),
      id: expense && String(expense.id ?? "").trim() ? String(expense.id) : newId(), day: Math.min(Math.max(Math.trunc(day ?? 1) || 1, 1), 28) };
    if (expense) await act("updateFlat", { tab: "Expenses", row: Number(expense.row), vals }, { msg: "Expense updated", busy: "Saving expense..." });
    else await act("append", { tab: "Expenses", row: vals }, { msg: "Expense added", busy: "Adding expense..." });
    setSaving(false); onClose();
  }
  const toggle = (m: string) => setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <Dialog open={open} onClose={onClose} title={expense ? "Edit expense" : "Add expense"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="What (Rent, Electricity, School fees...)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category"><Select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Amount"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
        </div>
        <Field label="Whose?"><Select value={owner} onChange={(e) => setOwner(e.target.value)}>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
        <div>
          <span className="mb-1 block text-xs font-semibold text-muted">How often</span>
          <Segmented value={scope} onChange={setScope} options={[{ value: "all", label: "Every month" }, { value: "some", label: "Only specific months" }]} />
        </div>
        {scope === "some" && (
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-muted">Which months?</legend>
            <div className="flex flex-wrap gap-2">
              {monthOpts.map((m) => (
                <button type="button" key={m} aria-pressed={months.includes(m)} onClick={() => toggle(m)}
                  className={cn("h-9 rounded-full border px-3 text-sm transition", months.includes(m) ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line text-muted hover:bg-soft")}>{monthLabel(m)}</button>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Due day of month (1-28)"><NumberInput value={day} onChange={setDay} /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
