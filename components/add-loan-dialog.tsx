"use client";
/** Add a loan (app.py::add_loan_dialog): import a PDF / screenshot, or answer a few questions; always confirm before saving. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, FileText, ImagePlus, Lock, PenLine, Upload } from "lucide-react";
import { useData } from "@/lib/app-context";
import { addMonths, parseDate, today } from "@/lib/dates";
import { dateLabel, inr } from "@/lib/format";
import * as L from "@/lib/loans";
import { LOAN_TYPES, installmentsDue, solveRate } from "@/lib/loans";
import { num } from "@/lib/state";
import type { Parsed } from "@/lib/importers";
import { Button, Card, Dialog, Field, Input, NumberInput, Select, cn } from "./ui";

type Step = "choose" | "pdf" | "image" | "preview" | "manual";
type Pending = { file: File; wrong: boolean };

export function AddLoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} wide persistent title="Add a loan or borrowing">{open && <Wizard onClose={onClose} />}</Dialog>;
}

function Wizard({ onClose }: { onClose: () => void }) {
  const { busy, toast } = useData();
  const [step, setStep] = useState<Step>("choose");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [from, setFrom] = useState<"pdf" | "image">("pdf");
  const [locked, setLocked] = useState<Pending | null>(null);

  const send = async (kind: "pdf" | "image", file: File, password?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (password) fd.append("password", password);
    try {
      const d = await busy(kind === "pdf" ? "Reading your PDF..." : "Claude is reading your screenshot...", async () => {
        const res = await fetch(`/api/import/${kind}`, { method: "POST", body: fd });
        const j = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        if (res.status === 401) throw new Error("Signed out - please reload and sign in again");
        return j as { parsed?: Parsed; needsPassword?: boolean; wrong?: boolean; error?: string };
      });
      if (d.needsPassword) { setLocked({ file, wrong: !!d.wrong }); return; }
      if (d.error || !d.parsed) { toast(kind === "pdf" ? `Could not read this PDF: ${d.error}` : (d.error ?? "Could not read the image"), "bad"); return; }
      setLocked(null); setFrom(kind); setParsed(d.parsed); setStep("preview");
    } catch (e) { toast((e as Error).message, "bad"); }
  };

  const tabsBar = (back?: Step) => back && (
    <button onClick={() => { setStep(back); setLocked(null); }} className="mb-3 inline-flex h-9 items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Back</button>);

  const stepNo = { choose: 1, pdf: 2, image: 2, manual: 2, preview: 3 }[step];
  return (
    <div className="pb-3">
      <div className="mb-4 flex items-center gap-2" aria-label={`Step ${stepNo} of 3`}>
        {[1, 2, 3].map((n) => <span key={n} className={cn("h-1.5 flex-1 rounded-full", n <= stepNo ? "bg-primary" : "bg-soft")} />)}
        <span className="text-xs text-muted">Step {stepNo}/3</span>
      </div>
      {step === "choose" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {([["pdf", FileText, "From a PDF", "Repayment schedule from your bank"], ["image", ImagePlus, "From a screenshot", "Drop a loan summary image"],
              ["manual", PenLine, "Answer a few questions", "No PDF? No problem - we'll work out the rate"]] as const).map(([k, I, t, s]) => (
              <button key={k} onClick={() => setStep(k)} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left transition hover:border-primary hover:shadow-md sm:flex-col sm:items-start">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><I className="h-5 w-5" /></span>
                <span><span className="block font-semibold">{t}</span><span className="block text-xs text-muted">{s}</span></span>
              </button>))}
          </div>
          <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Cancel</Button></div>
        </div>)}
      {step === "pdf" && (<>
        {tabsBar("choose")}
        <h3 className="text-lg font-semibold">Import from PDF</h3>
        <p className="mb-3 text-xs text-muted">Upload your lender&apos;s repayment schedule. Locked PDFs: you&apos;ll be asked for the password (it is not stored).</p>
        {locked ? <PasswordPrompt pending={locked} onSubmit={(pw) => send("pdf", locked.file, pw)} onCancel={() => setLocked(null)} />
          : <Drop accept="application/pdf,.pdf" label="Choose or drop a PDF" icon={<Upload className="h-6 w-6" />} onFile={(f) => send("pdf", f)} />}
      </>)}
      {step === "image" && (<>
        {tabsBar("choose")}
        <h3 className="text-lg font-semibold">Import from a screenshot</h3>
        <p className="mb-3 text-xs text-muted">Claude reads the amount, rate, tenure, EMI and instalments paid. You confirm before anything is saved.</p>
        <Drop accept="image/*" label="Choose, drop, or paste (Ctrl/Cmd+V) a screenshot" icon={<ImagePlus className="h-6 w-6" />} paste onFile={(f) => send("image", f)} />
      </>)}
      {step === "preview" && parsed && (<>
        {tabsBar(from)}
        <Preview p={parsed} onDone={onClose} />
      </>)}
      {step === "manual" && (<>
        {tabsBar("choose")}
        <Manual onDone={onClose} />
      </>)}
    </div>
  );
}

function Drop({ accept, label, icon, onFile, paste }: { accept: string; label: string; icon: ReactNode; onFile: (f: File) => void; paste?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const cb = useRef(onFile);
  useEffect(() => { cb.current = onFile; });
  useEffect(() => {
    if (!paste) return;
    const h = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (f) { e.preventDefault(); cb.current(f); }
    };
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, [paste]);
  return (
    <button type="button" onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={cn("flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm transition", over ? "border-primary bg-primary-soft" : "border-line bg-soft hover:border-primary")}>
      <span className="text-primary">{icon}</span><span className="font-medium">{label}</span>
      <input ref={ref} type="file" accept={accept} className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </button>
  );
}

function PasswordPrompt({ pending, onSubmit, onCancel }: { pending: Pending; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (pw) onSubmit(pw); }} className="space-y-3 rounded-2xl border border-line bg-soft p-4">
      <div className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 text-primary" />{pending.file.name} is password protected</div>
      <Field label="Password" error={pending.wrong ? "Wrong password - try again" : undefined}>
        <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
      </Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={!pw}>Unlock</Button></div>
    </form>
  );
}

function useOwners(extra?: string) {
  const { state } = useData();
  const base = state.persons().length ? state.persons() : ["Me"];
  return extra && !base.includes(extra) ? [...base, extra] : base;
}

function OwnerSelect({ value, onChange, owners }: { value: string; onChange: (v: string) => void; owners: string[] }) {
  return <Field label="Whose loan?"><Select value={value} onChange={(e) => onChange(e.target.value)}>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>;
}

function Preview({ p, onDone }: { p: Parsed; onDone: () => void }) {
  const { state, act } = useData();
  const owners = useOwners(p.owner);
  const [name, setName] = useState(p.name);
  const [lender, setLender] = useState(p.lender);
  const [owner, setOwner] = useState(p.owner && owners.includes(p.owner) ? p.owner : owners[0]);
  const [principal, setPrincipal] = useState<number | null>(p.principal);
  const [rate, setRate] = useState<number | null>(p.rate_pa);
  const [emi, setEmi] = useState<number | null>(p.emi);
  const needDates = !!p.needs_dates || !p.first_due_date;
  const dflt = needDates ? 0 : p.paid ?? installmentsDue(p.first_due_date!, today(), p.tenure_months);
  const [paid, setPaid] = useState<number | null>(dflt);
  const [next, setNext] = useState(addMonths(today(), 1));
  const [rt, setRt] = useState("floating");
  const [pc, setPc] = useState<number | null>(0);
  const [err, setErr] = useState("");
  const dup = state.loans.some((l) => Math.abs(num(l.principal) - p.principal) < 1 && Math.abs(num(l.emi) - p.emi) < 1);

  const save = async () => {
    const pd = Math.max(0, Math.min(p.tenure_months, Math.trunc(paid ?? 0)));
    let first = p.first_due_date as string;
    if (needDates) {
      const nd = parseDate(next);
      if (!nd) { setErr("Enter the next EMI date"); return; }
      first = addMonths(nd, -pd);
    }
    if (!name.trim() || !(principal && principal > 0) || !(emi && emi > 0)) { setErr("Name, loan amount and EMI are required"); return; }
    let schedule = p.schedule;
    if (p.rebuild || !schedule) schedule = p.rebuild ? L.schedule(principal, rate ?? 0, emi, p.tenure_months, first) : null;
    else if (needDates) schedule = schedule.map((r) => ({ ...r, due_date: addMonths(first, r.inst_no - 1) }));
    const id = await act("createEmiLoan", { name, lender, owner, principal, rate: rate ?? 0, emi, months: p.tenure_months, first_due: first, paid: pd,
      rate_type: rt, prepay_charge: pc ?? 0, notes: p.notes, schedule }, { msg: `'${name}' added to your Sheet`, busy: "Adding loan - creating its tab and updating your Sheet..." });
    if (id) onDone();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Check the details</h3>
      {p.notes && <p className="text-xs text-muted">{p.notes}</p>}
      {p.confidence && p.confidence !== "high" && <p className="text-xs text-warn">Confidence: {p.confidence} - please double-check the numbers.</p>}
      {dup && <p className="rounded-xl bg-warn-soft p-3 text-sm font-medium text-warn">This looks like a loan you&apos;ve already added.</p>}
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lender"><Input value={lender} onChange={(e) => setLender(e.target.value)} /></Field>
        <OwnerSelect value={owner} onChange={setOwner} owners={owners} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Loan amount"><NumberInput value={principal} onChange={setPrincipal} prefix="₹" /></Field>
        <Field label="Interest % p.a."><NumberInput value={rate} onChange={setRate} suffix="%" /></Field>
        <Field label="EMI"><NumberInput value={emi} onChange={setEmi} prefix="₹" /></Field>
      </div>
      <p className="text-sm">{p.tenure_months} instalments{!needDates && p.first_due_date ? `, first due ${dateLabel(p.first_due_date)}` : ""}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={"EMIs already paid" + (!needDates && p.paid != null ? " (read from the screenshot)" : !needDates ? " (we assume all past due dates are paid)" : "")}>
          <NumberInput value={paid} onChange={setPaid} />
        </Field>
        {needDates && <Field label="Next EMI date" hint="The PDF has no dates"><Input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rate type"><Select value={rt} onChange={(e) => setRt(e.target.value)}><option>floating</option><option>fixed</option></Select></Field>
        <Field label="Prepayment charge %"><NumberInput value={pc} onChange={setPc} suffix="%" /></Field>
      </div>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end"><Button onClick={save}>Add to Sheet</Button></div>
    </div>
  );
}

function Manual({ onDone }: { onDone: () => void }) {
  const { act } = useData();
  const owners = useOwners();
  const [kind, setKind] = useState("bank_emi");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(owners[0]);
  const [lender, setLender] = useState("");
  const [amt, setAmt] = useState<number | null>(null);
  const [emi, setEmi] = useState<number | null>(null);
  const [months, setMonths] = useState<number | null>(null);
  const [paid, setPaid] = useState<number | null>(0);
  const [next, setNext] = useState(addMonths(today(), 1));
  const [rate, setRate] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [rt, setRt] = useState("floating");
  const [pc, setPc] = useState<number | null>(0);
  const [start, setStart] = useState(today());
  const [term, setTerm] = useState<number | null>(12);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const est = amt && emi && months && amt > 0 && emi > 0 && months > 0 ? solveRate(amt, emi, Math.trunc(months)) : null;
  const shownRate = touched ? rate : est ?? rate;
  const done = async (name: string, action: string, args: Record<string, unknown>) => {
    const id = await act(action, args, { msg: `'${name}' added to your Sheet`, busy: "Adding loan - creating its tab and updating your Sheet..." });
    if (id) onDone();
  };

  const save = async () => {
    setErr("");
    if (kind === "bank_emi") {
      if (!name.trim() || !(amt && emi && months)) return setErr("Please fill name, amount, EMI and months");
      const pd = Math.trunc(paid ?? 0), nd = parseDate(next) ?? addMonths(today(), 1);
      const given = touched && !!rate;
      return done(name, "createEmiLoan", { name, lender: lender || "-", owner, principal: amt, rate: given ? rate : solveRate(amt, emi, Math.trunc(months)), emi,
        months: Math.trunc(months), first_due: addMonths(nd, -pd), paid: pd, rate_type: rt, prepay_charge: pc ?? 0, notes: "Entered manually; rate " + (given ? "given" : "estimated") });
    }
    if (kind === "bullet") {
      if (!name.trim() || !(amt && amt > 0) || !parseDate(start) || !(term && term > 0)) return setErr("Please fill name, amount, start date and term");
      return done(name, "createBulletLoan", { name, lender: lender || "-", owner, principal: amt, rate: rate ?? 0, start, months: Math.trunc(term), notes: note });
    }
    if (!name.trim() || !(amt && amt > 0)) return setErr("Please fill name and amount owed");
    const m = monthly ?? 0;
    return done(name, "createSimpleLoan", { name, owner, kind, outstanding: amt, monthly: m, rate: kind === "interest_only" ? Math.round((m * 1200) / amt * 1000) / 1000 : 0,
      deadline: kind === "interest_free_deadline" && parseDate(deadline) ? deadline : null, notes: note });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Tell us about it</h3>
      <Field label="What kind of loan is it?"><Select value={kind} onChange={(e) => { setKind(e.target.value); setErr(""); }}>{Object.entries(LOAN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Give it a name" hint="e.g. 'Home loan', 'Rohan - personal'"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <OwnerSelect value={owner} onChange={setOwner} owners={owners} />
      {kind === "bank_emi" && (<>
        <Field label="Bank / lender"><Input value={lender} onChange={(e) => setLender(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How much did you borrow?"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
          <Field label="What is your monthly EMI?"><NumberInput value={emi} onChange={setEmi} prefix="₹" /></Field>
          <Field label="Total number of months"><NumberInput value={months} onChange={setMonths} /></Field>
          <Field label="How many EMIs have you paid so far?"><NumberInput value={paid} onChange={setPaid} /></Field>
        </div>
        <Field label="Date of your next EMI"><Input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {est != null && <p className="text-sm text-primary">Estimated interest: about {est}% per year</p>}
        <Field label="Interest % p.a." hint="Leave as estimated if you don't know"><NumberInput value={shownRate} suffix="%" onChange={(v) => { setRate(v); setTouched(v != null); }} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rate type"><Select value={rt} onChange={(e) => setRt(e.target.value)}><option>floating</option><option>fixed</option></Select></Field>
          <Field label="Prepayment charge %"><NumberInput value={pc} onChange={setPc} suffix="%" /></Field>
        </div>
      </>)}
      {kind === "bullet" && (<>
        <Field label="Bank / lender"><Input value={lender} onChange={(e) => setLender(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How much did you borrow?"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
          <Field label="Interest % p.a."><NumberInput value={rate} onChange={setRate} suffix="%" /></Field>
          <Field label="Loan start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Term (months)"><NumberInput value={term} onChange={setTerm} /></Field>
        </div>
        {amt && amt > 0 && term && term > 0 && <p className="text-sm text-primary">Interest about {inr((amt * (rate ?? 0)) / 1200)} a month, principal at the end</p>}
        <Field label="Notes (account no., gold details...)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </>)}
      {kind !== "bank_emi" && kind !== "bullet" && (<>
        <Field label="How much do you still owe?"><NumberInput value={amt} onChange={setAmt} prefix="₹" /></Field>
        {(kind === "interest_only" || kind === "fixed_monthly") && (
          <Field label={kind === "interest_only" ? "How much interest do you pay each month?" : "How much do you pay each month?"}><NumberInput value={monthly} onChange={setMonthly} prefix="₹" /></Field>)}
        {kind === "interest_free_deadline" && <Field label="Deadline to repay"><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>}
        <Field label="Notes (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </>)}
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <Card className="border-0 bg-transparent p-0 shadow-none"><div className="flex justify-end"><Button onClick={save}>Add to Sheet</Button></div></Card>
    </div>
  );
}
