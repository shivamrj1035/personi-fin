"use client";
/** Edit a loan (app.py::edit_loan_dialog). */
import { useState } from "react";
import { useData } from "@/lib/app-context";
import { today } from "@/lib/dates";
import { parseDate } from "@/lib/dates";
import { num, type Row } from "@/lib/state";
import { Button, Dialog, Field, Input, NumberInput, Select } from "./ui";

export function EditLoanDialog({ loan, onClose }: { loan: Row | null; onClose: () => void }) {
  return <Dialog open={!!loan} onClose={onClose} title="Edit loan">{loan && <Form key={loan.id} loan={loan} onClose={onClose} />}</Dialog>;
}

function Form({ loan: l, onClose }: { loan: Row; onClose: () => void }) {
  const { state, act } = useData();
  const sch = state.schedule(l.id);
  const owners = [...state.persons(), ...(l.owner && !state.persons().includes(l.owner) ? [l.owner] : [])];
  const t = l.type as string;
  const [name, setName] = useState<string>(l.name ?? "");
  const [lender, setLender] = useState<string>(l.lender ?? "");
  const [owner, setOwner] = useState<string>(l.owner ?? owners[0] ?? "");
  const [rate, setRate] = useState<number | null>(t.startsWith("interest_free") ? 0 : num(l.rate_pa));
  const [emi, setEmi] = useState<number | null>(num(l.emi));
  const [deadline, setDeadline] = useState<string>(parseDate(l.deadline) ?? today());
  const [firstDue, setFirstDue] = useState<string>(parseDate(l.first_due_date) ?? today());
  const [paid, setPaid] = useState<number | null>(state.paidCount(l.id));
  const [rateType, setRateType] = useState<string>(l.rate_type === "fixed" ? "fixed" : "floating");
  const [charge, setCharge] = useState<number | null>(num(l.prepay_charge_pct));
  const [notes, setNotes] = useState<string>(String(l.notes ?? ""));
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Name can't be empty"); return; }
    const ok = await act("editLoan", {
      loanId: l.id, name, lender, owner, rate: rate ?? 0, emi: emi ?? 0, rate_type: rateType, prepay_charge: charge ?? 0,
      deadline: t === "interest_free_deadline" || t === "bullet" ? deadline : null, notes,
      paid: sch.length ? Math.max(0, Math.min(sch.length, Math.trunc(paid ?? 0))) : null,
      first_due: t === "fixed_monthly" || t === "interest_only" ? firstDue : null,
    }, { msg: "Loan updated", busy: "Saving changes and updating your Sheet..." });
    if (ok) onClose();
  };

  return (
    <div className="space-y-3 pb-2">
      <Field label="Name" error={err}><Input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lender"><Input value={lender} onChange={(e) => setLender(e.target.value)} /></Field>
        <Field label="Whose loan?">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {owners.length === 0 && <option value="">Unassigned</option>}
            {owners.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interest % p.a."><NumberInput value={rate} onChange={setRate} suffix="%" disabled={t.startsWith("interest_free")} /></Field>
        <Field label={t === "interest_only" ? "Interest paid / month" : t === "bullet" ? "Payable at the end (auto)" : t.startsWith("interest_free") ? "Monthly amount" : "EMI / monthly amount"}>
          <NumberInput value={emi} onChange={setEmi} prefix="₹" disabled={t === "bullet"} />
        </Field>
      </div>
      {(t === "interest_free_deadline" || t === "bullet") && (
        <Field label={t === "bullet" ? "Due date" : "Deadline"}><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      )}
      {(t === "fixed_monthly" || t === "interest_only") && (
        <Field label="Next payment date (payments start this month)" hint="Unpaid payments from earlier months move forward to the current month in red until you pay them.">
          <Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
        </Field>
      )}
      {sch.length > 0 && (
        <Field label={`EMIs paid (of ${sch.length})`} hint="Changing the rate or EMI rebuilds the unpaid instalments from today's balance.">
          <NumberInput value={paid} onChange={setPaid} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rate type"><Select value={rateType} onChange={(e) => setRateType(e.target.value)}><option>floating</option><option>fixed</option></Select></Field>
        <Field label="Prepayment charge %"><NumberInput value={charge} onChange={setCharge} suffix="%" /></Field>
      </div>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}
