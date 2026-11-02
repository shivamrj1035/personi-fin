"use client";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/app-context";
import { monthLong } from "@/lib/dates";
import { buildReport, entries, inr, SECTIONS, type Lang } from "@/lib/report";
import { Button, Checkbox, Dialog, Segmented } from "./ui";

const LABELS: Record<Lang, Record<string, string>> = {
  en: { summary: "Summary", income: "Income", people: "Who earned & paid", loans: "Loan payments", expenses: "Expenses", balances: "Loan balances" },
  gu: { summary: "સારાંશ", income: "આવક", people: "કોણે કમાયું / ચૂકવ્યું", loans: "લોનની ચુકવણી", expenses: "ખર્ચ", balances: "લોનની બાકી રકમ" },
};
const GROUPS = { income: "Income", loans: "Loan payments & extra payments", expenses: "Expenses", balances: "Loan balances" } as const;
const CARD_W = 880;

/** Pick sections + language, leave out entries, preview, and download the month report as PNG or PDF. */
export function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, month, toast, busy } = useData();
  const [chosen, setChosen] = useState<Record<string, boolean>>({ summary: true, income: true, people: true, loans: true, expenses: true, balances: false });
  const [lang, setLang] = useState<Lang>("en");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [innerH, setInnerH] = useState(600);

  const ents = useMemo(() => entries(state, month), [state, month]);
  const secs = SECTIONS.filter((s) => chosen[s]);
  const html = useMemo(() => (secs.length ? buildReport(state, month, secs, lang, excluded) : ""), [state, month, secs.join(","), lang, excluded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, Math.max(el.clientWidth - 16, 200) / CARD_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, secs.length]);

  useEffect(() => { if (open && inner.current) setInnerH(inner.current.offsetHeight); }, [open, html, lang]);

  const setGroup = (g: keyof typeof GROUPS, include: boolean) => setExcluded((p) => { const n = new Set(p); for (const r of ents[g]) { if (include) n.delete(r.key); else n.add(r.key); } return n; });
  const toggle = (k: string, inc: boolean) => setExcluded((p) => { const n = new Set(p); if (inc) n.delete(k); else n.add(k); return n; });

  const download = async (fmt: "png" | "pdf") => {
    const el = document.getElementById("report-card");
    if (!el) { toast("Pick at least one section", "warn"); return; }
    const name = `EL-Tracker-${month.slice(0, 7)}-${lang}.${fmt}`;
    try {
      await busy(fmt === "pdf" ? "Creating your PDF..." : "Creating your image...", async () => {
        await document.fonts?.ready;
        const { toPng } = await import("html-to-image");
        // the card itself is full size; only its wrapper is scaled for the preview
        const opts = { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true };
        const png = await toPng(el, opts);
        if (fmt === "png") { const a = document.createElement("a"); a.download = name; a.href = png; document.body.appendChild(a); a.click(); a.remove(); return; }
        const { jsPDF } = await import("jspdf");
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("Could not render the report")); img.src = png; });
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        const margin = 8, usableW = 210 - 2 * margin, usableH = 297 - 2 * margin;
        const sliceH = Math.floor((img.width * usableH) / usableW);
        for (let y = 0, page = 0; y < img.height; y += sliceH, page++) {
          const h = Math.min(sliceH, img.height - y);
          const part = document.createElement("canvas");
          part.width = img.width; part.height = h;
          part.getContext("2d")!.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
          if (page > 0) pdf.addPage();
          pdf.addImage(part.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, usableW, (usableW * h) / img.width);
        }
        pdf.save(name);
      });
      toast(fmt === "pdf" ? "PDF downloaded" : "Image downloaded", "good");
    } catch (e) { toast(`Could not create the file: ${(e as Error).message}`.slice(0, 200), "bad"); }
  };

  const picked = (Object.keys(GROUPS) as (keyof typeof GROUPS)[]).filter((g) => chosen[g] && ents[g].length);
  const lbl = LABELS[lang];
  return (
    <Dialog open={open} onClose={onClose} wide title={`Download image - ${monthLong(month)}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="outline" icon={<FileText className="h-4 w-4" />} disabled={!secs.length} onClick={() => void download("pdf")}>Download PDF</Button>
        <Button icon={<ImageIcon className="h-4 w-4" />} disabled={!secs.length} onClick={() => void download("png")}>Download PNG</Button>
      </>}>
      <div className="space-y-3 pb-2">
        <p className="text-sm text-muted">Choose what to include and the language, then download.</p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap gap-x-4">
            {SECTIONS.map((s) => <Checkbox key={s} checked={!!chosen[s]} onChange={(v) => setChosen((p) => ({ ...p, [s]: v }))} label={lbl[s]} />)}
          </div>
          <Segmented<Lang> value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "gu", label: "ગુજરાતી" }]} />
        </div>

        <details className="rounded-xl border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
            <span>Leave out individual entries</span>
            <span className="text-xs text-muted">{excluded.size ? `${excluded.size} left out` : "all included"}</span>
          </summary>
          <div className="max-h-64 space-y-2 overflow-y-auto border-t border-line px-3 py-2">
            {picked.length === 0 && <p className="text-sm text-muted">Tick Income, Loan payments, Expenses or Loan balances above to pick entries.</p>}
            {picked.map((g) => (
              <div key={g}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-primary">{GROUPS[g]}</span>
                  <Button size="sm" variant="ghost" onClick={() => setGroup(g, true)}>All</Button>
                  <Button size="sm" variant="ghost" onClick={() => setGroup(g, false)}>None</Button>
                </div>
                {ents[g].map((r) => <Checkbox key={r.key} checked={!excluded.has(r.key)} onChange={(v) => toggle(r.key, v)} label={`${r.label} - ${inr(r.amount)}`} />)}
              </div>
            ))}
          </div>
        </details>

        <div ref={box} className="max-h-[55dvh] overflow-auto rounded-xl border border-line bg-soft p-2" aria-label="Report preview">
          {secs.length ? (
            <div style={{ width: CARD_W * scale, height: innerH * scale }} className="mx-auto overflow-hidden">
              <div ref={inner} style={{ width: CARD_W, transform: `scale(${scale})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ) : <div className="p-5 text-sm text-muted">Pick at least one section.</div>}
        </div>
        <p className="flex items-center gap-1 text-xs text-muted"><Download className="h-3 w-3" />The file is generated at full size, whatever the preview scale.</p>
      </div>
    </Dialog>
  );
}
