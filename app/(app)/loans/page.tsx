"use client";
/** Loans & borrowings (app.py::loans_page, loan_card, loan_detail). */
import { useMemo, useState } from "react";
import { Bolt, CalendarClock, Check, ChevronRight, Landmark, Pencil, Plus, Trash2, Undo2, Wallet } from "lucide-react";
import { useData } from "@/lib/app-context";
import { parseDate, today } from "@/lib/dates";
import { dateLabel, inr, monthsLabel } from "@/lib/format";
import { LOAN_TYPES, installmentsDue, prepaymentEffect } from "@/lib/loans";
import { num, truthy, type Row } from "@/lib/state";
import { AddLoanDialog } from "@/components/add-loan-dialog";
import { EditLoanDialog } from "@/components/edit-loan-dialog";
import { Badge, Button, Card, Dialog, Empty, Field, Kpi, KpiGrid, NumberInput, PageHeader, Progress, Segmented, Select, cn } from "@/components/ui";

type Filter = "active" | "closed" | "all";
type Sort = "outstanding" | "due" | "name";

export default function LoansPage() {
  const { state } = useData();
  const [filter, setFilter] = useState<Filter>("active");
  const [sort, setSort] = useState<Sort>("outstanding");
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const isActive = (l: Row) => l.status !== "closed" && state.outstanding(l) > 0.005;
  const active = state.activeLoans();
  const totals = useMemo(() => ({
    out: active.reduce((s, l) => s + state.outstanding(l), 0),
    monthly: active.reduce((s, l) => s + state.monthlyDue(l), 0),
  }), [active, state]);

  const list = useMemo(() => {
    const rows = state.loans.filter((l) => (filter === "all" ? true : filter === "active" ? isActive(l) : !isActive(l)));
    const key = (l: Row) => state.nextDue(l)[0] ?? "9999-12-31";
    return [...rows].sort((a, b) => sort === "name" ? String(a.name).localeCompare(String(b.name))
      : sort === "due" ? key(a).localeCompare(key(b)) : state.outstanding(b) - state.outstanding(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filter, sort]);

  const detail = detailId ? state.loans.find((l) => l.id === detailId) ?? null : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Loans & borrowings" subtitle={`${active.length} active of ${state.loans.length}`}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add loan</Button>} />

      {state.loans.length > 0 && (
        <KpiGrid>
          <Kpi label="Total outstanding" value={inr(totals.out)} icon={<Landmark />} />
          <Kpi label="Due every month" value={inr(totals.monthly)} icon={<CalendarClock />} tone="warn" />
          <Kpi label="Active loans" value={active.length} icon={<Wallet />} tone="good" className="col-span-2 lg:col-span-1" />
        </KpiGrid>
      )}

      {state.loans.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Filter> value={filter} onChange={setFilter} className="sm:min-w-72"
            options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
          <Select aria-label="Sort loans" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-full sm:w-52">
            <option value="outstanding">Sort: largest balance</option><option value="due">Sort: next due</option><option value="name">Sort: name</option>
          </Select>
        </div>
      )}

      {state.loans.length === 0 ? (
        <Empty icon={<Landmark />} title="No loans yet" action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add your first loan</Button>}>
          Import a bank schedule PDF or screenshot, or answer a few questions.
        </Empty>
      ) : list.length === 0 ? (
        <Empty title={filter === "closed" ? "No closed loans" : "No active loans"}>Try another filter.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((l) => <LoanCard key={l.id} loan={l} onOpen={() => setDetailId(l.id)} onEdit={() => setEditing(l)} />)}
        </div>
      )}

      <AddLoanDialog open={adding} onClose={() => setAdding(false)} />
      <EditLoanDialog loan={editing} onClose={() => setEditing(null)} />
      {detail && <LoanDetail loan={detail} onClose={() => setDetailId(null)} onEdit={() => setEditing(detail)} />}
    </div>
  );
}

function LoanCard({ loan: l, onOpen, onEdit }: { loan: Row; onOpen: () => void; onEdit: () => void }) {
  const { state } = useData();
  const out = state.outstanding(l);
  const principal = num(l.principal) || out;
  const pct = principal ? Math.max(0, Math.min(1, 1 - out / principal)) : 0;
  const [due, amt] = state.nextDue(l);
  const total = num(l.tenure_months);
  const closed = l.status === "closed" || out <= 0.005;
  return (
    <Card className="flex min-w-0 flex-col gap-3 transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label={`Open ${l.name}`}>
          <div className="flex flex-wrap items-center gap-2"><span className="truncate text-base font-semibold">{l.name}</span>{closed && <Badge tone="good">Closed</Badge>}</div>
          <div className="mt-0.5 text-xs text-muted">{l.lender} · {l.owner || "unassigned"} · {LOAN_TYPES[l.type] ?? l.type}</div>
        </button>
        <div className="flex shrink-0 items-start gap-1">
          <div className="text-right"><div className="text-lg font-bold tabular-nums">{inr(out)}</div><div className="text-xs text-muted">outstanding</div></div>
          <Button variant="ghost" size="icon" aria-label={`Edit ${l.name}`} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
        </div>
      </div>
      <Progress value={pct} tone="indigo" />
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>{Math.round(pct * 100)}% repaid{total ? ` · ${state.paidCount(l.id)}/${Math.trunc(total)} EMIs` : ""}</span>
        <span>{due ? `Next: ${inr(amt)} on ${dateLabel(due)}` : `Monthly: ${inr(state.monthlyDue(l))}`}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{num(l.rate_pa) ? `${num(l.rate_pa)}% p.a.` : "No interest"}{l.rate_type ? ` · ${l.rate_type}` : ""}</span>
        <Button variant="soft" size="sm" onClick={onOpen}>Manage<ChevronRight className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

function LoanDetail({ loan: l, onClose, onEdit }: { loan: Row; onClose: () => void; onEdit: () => void }) {
  const { state, act } = useData();
  const out = state.outstanding(l);
  const sch = [...state.schedule(l.id)].sort((a, b) => num(a.inst_no) - num(b.inst_no));
  const rate = num(l.rate_pa);
  const payers = [...(state.persons().length ? state.persons() : ["Me"]), "Joint"];
  const [payer, setPayer] = useState<string>(payers.includes(l.owner) ? l.owner : payers[0]);
  const [confirmDel, setConfirmDel] = useState(false);
  const bullet = l.type === "bullet";
  const left = sch.filter((s) => !truthy(s.paid)).length;

  const del = async () => {
    const ok = await act("deleteLoan", { loanId: l.id }, { msg: "Loan deleted" });
    if (ok) { setConfirmDel(false); onClose(); }
  };

  return (
    <>
      <Dialog open onClose={onClose} wide title={l.name}
        footer={<>
          <Button variant="ghost" className="mr-auto text-bad" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDel(true)}>Delete loan</Button>
          <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit</Button></>}>
        <div className="space-y-5 pb-3">
          <p className="text-sm text-muted">{l.lender} · {l.owner || "unassigned"} · {l.rate_type} rate · {LOAN_TYPES[l.type] ?? l.type}</p>
          <KpiGrid>
            <Kpi label="Outstanding" value={inr(out)} icon={<Landmark />} />
            <Kpi label="Interest rate" value={rate ? `${rate}%` : "0%"} icon={<Bolt />} tone="warn" />
            {bullet ? (<>
              <Kpi label="Interest / month" value={inr(state.monthlyDue(l))} sub="paid each month-end (varies with days)" tone="bad" />
              <Kpi label={`Principal due ${dateLabel(parseDate(l.deadline))}`} value={inr(out)} sub="paid in one go to close the loan" tone="warn" />
              <Kpi label="Save / month to close" value={inr(state.bulletSavePerMonth(l))} sub={`${state.monthsToDeadline(l)} months left`} tone="good" />
            </>) : <Kpi label="Monthly" value={inr(state.monthlyDue(l))} icon={<CalendarClock />} />}
            {sch.length > 0 && <Kpi label="EMIs left" value={left} sub={`${sch.length - left} paid`} tone="good" />}
          </KpiGrid>

          <Field label="Payments recorded here are paid by" className="sm:max-w-xs">
            <Select value={payer} onChange={(e) => setPayer(e.target.value)}>{payers.map((p) => <option key={p}>{p}</option>)}</Select>
          </Field>

          {sch.length > 0 ? (<>
            <PrepaySim loan={l} out={out} payer={payer} />
            <ScheduleSection loan={l} sch={sch} />
          </>) : <ExtraPay loan={l} out={out} payer={payer} />}

          {l.deadline && !bullet && <p className="font-medium text-warn">Deadline: {dateLabel(parseDate(l.deadline))}</p>}
        </div>
      </Dialog>
      <Dialog open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete loan?"
        footer={<><Button variant="outline" onClick={() => setConfirmDel(false)}>Cancel</Button><Button variant="danger" onClick={del}>Delete</Button></>}>
        <p className="pb-3 text-sm">Delete &lsquo;{l.name}&rsquo; and all its rows from the Sheet? This cannot be undone.</p>
      </Dialog>
    </>
  );
}

function PrepaySim({ loan: l, out, payer }: { loan: Row; out: number; payer: string }) {
  const { act } = useData();
  const [amt, setAmt] = useState<number | null>(Math.min(50000, Math.round(out)));
  const [keep, setKeep] = useState<"keep" | "lower">("keep");
  const a = amt ?? 0, emiAmt = num(l.emi);
  const r = prepaymentEffect(out, num(l.rate_pa), emiAmt, a, keep === "keep");
  const charge = (num(l.prepay_charge_pct) / 100) * a;
  const valid = a > 0 && a <= out;
  const apply = () => act("applyPrepayment", { loanId: l.id, amount: a, keepEmi: keep === "keep", extra: null, paidBy: payer },
    { msg: `Prepayment of ${inr(a)} recorded; schedule rebuilt` });
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">Prepayment simulator</h3>
      <Card className="space-y-3">
        <Field label="Part-prepayment amount" error={a > out ? "More than the outstanding balance" : undefined} className="sm:max-w-xs"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
        <Segmented<"keep" | "lower"> value={keep} onChange={setKeep} options={[{ value: "keep", label: "Keep EMI, finish sooner" }, { value: "lower", label: "Lower EMI, same tenure" }]} />
        <p className="rounded-xl bg-good-soft p-3 text-sm text-good" aria-live="polite">
          {keep === "keep" ? `Finish ${monthsLabel(r.months_saved)} sooner and save about ${inr(r.interest_saved)} interest.`
            : `New EMI ${inr(r.new_emi ?? 0)} (was ${inr(emiAmt)}); saves about ${inr(r.interest_saved)} interest.`}
          {charge > 0 && <span className="block text-warn">Prepayment charge: {inr(charge)}.</span>}
        </p>
        <Button disabled={!valid} icon={<Bolt className="h-4 w-4" />} onClick={apply} className="w-full sm:w-auto">Apply prepayment &amp; rebuild schedule</Button>
      </Card>
    </section>
  );
}

function ExtraPay({ loan: l, out, payer }: { loan: Row; out: number; payer: string }) {
  const { state, act } = useData();
  const bullet = l.type === "bullet";
  const [amt, setAmt] = useState<number | null>(bullet ? Math.min(50000, Math.round(out)) : num(l.emi) || null);
  const a = amt ?? 0;
  const [base, withx] = bullet ? state.bulletEffect(l, a) : [0, 0];
  const pay = () => act("logPayment", { loanId: l.id, amount: a, note: "", paidBy: payer }, { msg: `${inr(a)} recorded in this month's tab` });
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{bullet ? "Pay it off sooner" : "Record an extra payment"}</h3>
      <Card className="space-y-3">
        {bullet && <p className="text-xs text-muted">You pay only interest each month; the principal is due on the end date. Every rupee of principal paid early cuts the monthly interest. No part-payment charge is shown in the sanction letter, but confirm with the branch.</p>}
        <Field label="Amount paid" className="sm:max-w-xs"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
        {bullet && a > 0 && <p className="rounded-xl bg-good-soft p-3 text-sm text-good">Pay {inr(a)} of principal now: monthly interest drops by about {inr((a * num(l.rate_pa)) / 1200)}, saving about {inr(base - withx)} until the due date. Principal left: {inr(Math.max(out - a, 0))}.</p>}
        <Button disabled={a <= 0} icon={<Check className="h-4 w-4" />} onClick={pay} className="w-full sm:w-auto">Save payment</Button>
      </Card>
    </section>
  );
}

function ScheduleSection({ loan: l, sch }: { loan: Row; sch: Row[] }) {
  const { state, act } = useData();
  const paid = state.paidCount(l.id);
  const [through, setThrough] = useState<number | null>(Math.min(paid + 1, sch.length));
  const [all, setAll] = useState(false);
  const set = (n: number, msg: string) => act("setPaidThrough", { loanId: l.id, n }, { msg });
  const firstUnpaid = Math.max(sch.findIndex((s) => !truthy(s.paid)), 0);
  const start = all ? 0 : Math.max(firstUnpaid - 1, 0);
  const rows = all ? sch : sch.slice(start, start + 12);
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted";
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">Repayment schedule</h3>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Check className="h-4 w-4" />} disabled={paid >= sch.length} onClick={() => set(paid + 1, `EMI #${paid + 1} marked paid`)}>Mark next EMI paid</Button>
        <Button size="sm" variant="outline" onClick={() => { const n = installmentsDue(parseDate(sch[0].due_date)!, today(), sch.length); void set(n, `Marked ${n} EMIs paid (all due till today)`); }}>Mark all due till today as paid</Button>
        <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} disabled={paid === 0} onClick={() => set(Math.max(paid - 1, 0), "Last EMI un-marked")}>Undo last</Button>
      </div>
      <div className="flex items-end gap-2">
        <Field label={`Mark EMIs paid through # (0-${sch.length})`} className="w-48"><NumberInput value={through} onChange={setThrough} /></Field>
        <Button size="md" variant="outline" disabled={through == null || through < 0 || through > sch.length || through === paid}
          onClick={() => set(Math.trunc(through ?? 0), `Marked ${Math.trunc(through ?? 0)} EMIs paid`)}>Apply</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead className="bg-soft"><tr>{["No", "Due", "Opening", "Principal", "Interest", "EMI", "Closing", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => { const p = truthy(r.paid); return (
              <tr key={r.inst_no} className={cn("border-t border-line", !p && num(r.inst_no) === num(sch[firstUnpaid]?.inst_no) && "bg-primary-soft")}>
                <td className="px-3 py-2">{num(r.inst_no)}</td><td className="px-3 py-2">{dateLabel(parseDate(r.due_date))}</td>
                <td className="px-3 py-2">{inr(num(r.opening))}</td><td className="px-3 py-2">{inr(num(r.principal))}</td>
                <td className="px-3 py-2">{inr(num(r.interest))}</td><td className="px-3 py-2">{inr(num(r.emi))}</td>
                <td className="px-3 py-2">{inr(num(r.closing))}</td><td className="px-3 py-2"><Badge tone={p ? "good" : "slate"}>{p ? "Paid" : "Due"}</Badge></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      {sch.length > 12 && <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${sch.length} instalments`}</Button>}
    </section>
  );
}
