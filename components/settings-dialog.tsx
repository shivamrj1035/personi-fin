"use client";
import { useState } from "react";
import { useData } from "@/lib/app-context";
import { num } from "@/lib/state";
import { Button, Dialog, Field, Input, NumberInput } from "./ui";

/** Mounted only while open, so the fields start from the saved values every time. */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <SettingsForm onClose={onClose} /> : null;
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const open = true;
  const { state, act } = useData();
  const [persons, setPersons] = useState(state.settings.persons ?? "");
  const [buffer, setBuffer] = useState<number | null>(num(state.settings.emergency_buffer));
  const save = async () => {
    const a = await act("setSetting", { key: "persons", value: persons }, { busy: "Saving settings..." });
    const b = a !== undefined && await act("setSetting", { key: "emergency_buffer", value: buffer ?? 0 }, { msg: "Settings saved", busy: "Saving settings..." });
    if (b !== undefined && b !== false) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Settings" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-4 pb-2">
        <Field label="Earners (comma separated)"><Input value={persons} onChange={(e) => setPersons(e.target.value)} placeholder="Shivam, Rajesh, Hetal" /></Field>
        <Field label="Emergency buffer to keep each month" hint="Never counted as spare money for prepayments or investing."><NumberInput prefix="₹" value={buffer} onChange={setBuffer} /></Field>
      </div>
    </Dialog>
  );
}
