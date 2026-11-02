"use client";
/** Add income (app.py::income_dialog): fixed = repeats every month, variable = one-off for a chosen month. */
import { useId, useState } from "react";
import { Button, Dialog, Field, Input, NumberInput, Segmented } from "@/components/ui";
import { useData } from "@/lib/app-context";
import { inr } from "@/lib/format";

export function IncomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <IncomeForm onClose={onClose} /> : null;
}

function IncomeForm({ onClose }: { onClose: () => void }) {
  const open = true;
  const { state, act, mk } = useData();
  const people = state.persons().length ? state.persons() : ["Me"];
  const listId = useId();
  const [person, setPerson] = useState(people[0]);
  const [source, setSource] = useState("");
  const [type, setType] = useState<"fixed" | "variable">("fixed");
  const [amount, setAmount] = useState<number | null>(null);
  const [month, setMonth] = useState(mk);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!person.trim()) return setErr("Who earns it?");
    if (!source.trim() || !(amount && amount > 0)) return setErr("Fill source and amount");
    if (type === "variable" && !/^\d{4}-\d{2}$/.test(month)) return setErr("Pick the month it applies to");
    setErr(""); setSaving(true);
    await (type === "fixed"
      ? act("addRecurring", { person: person.trim(), source: source.trim(), amount, also: `${mk}-01` }, { msg: "Added to this and next month's tabs", busy: "Adding income to your month tabs..." })
      : act("addIncome", { month: `${month}-01`, person: person.trim(), source: source.trim(), amount, type: "variable", received: false }, { msg: "Income added to that month's tab", busy: "Adding income..." }));
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add income"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <form className="space-y-3 pb-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Who earns it?">
          <Input list={listId} value={person} onChange={(e) => setPerson(e.target.value)} autoComplete="off" />
          <datalist id={listId}>{people.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Source (Salary, Freelance, Rent...)"><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Salary" /></Field>
        <div>
          <span className="mb-1 block text-xs font-semibold text-muted">Type</span>
          <Segmented value={type} onChange={setType} options={[{ value: "fixed", label: "Fixed - every month" }, { value: "variable", label: "Variable / one-off" }]} />
        </div>
        <Field label="Amount"><NumberInput value={amount} onChange={setAmount} prefix="₹" /></Field>
        {type === "variable" && <Field label="Month it applies to"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
        {type === "fixed" && <p className="text-xs text-muted">Repeats every month{amount ? ` (${inr(amount)})` : ""} and is added to this month right away.</p>}
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
