"use client";

import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useAppFeedback } from "@/components/ui/app-feedback";
import { createBusinessClientAction } from "@/app/mi-negocio/actions";

const INPUT_CLASS = "w-full text-sm rounded-xl border border-stampa-border bg-stampa-surface px-3 py-2.5 text-white outline-none focus:border-stampa-orange focus:ring-1 focus:ring-stampa-orange";

interface CustomerQuickCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (client: { id: string; name: string }) => void;
}

export function CustomerQuickCreateDialog({ open, onClose, onCreated }: CustomerQuickCreateDialogProps) {
  const { toast } = useAppFeedback();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("El nombre del cliente es obligatorio.");
    setSaving(true);
    const result = await createBusinessClientAction({ name, phone, email, notes });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success(`Cliente ${result.name} creado.`);
    onCreated({ id: result.clientId, name: result.name });
    reset();
  };

  return (
    <Dialog open={open} onClose={handleClose} labelledBy="quick-create-client-title" panelClassName="max-w-md rounded-2xl border border-stampa-border bg-stampa-surface">
      <div className="p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-stampa-orange/10 text-stampa-orange"><UserPlus size={18} /></span>
        <h2 id="quick-create-client-title" className="mt-3 text-lg font-black text-white">Nuevo cliente</h2>
        <p className="mt-1 text-sm text-gray-400">Solo el nombre es obligatorio. Podés completar el resto después desde la ficha del cliente.</p>
        <div className="mt-4 grid gap-3">
          <label className="block text-xs font-semibold text-gray-400">Nombre *
            <input type="text" autoFocus placeholder="Ej. Juan Pérez" value={name} onChange={(event) => setName(event.target.value)} className={`mt-1.5 min-h-11 ${INPUT_CLASS}`} />
          </label>
          <label className="block text-xs font-semibold text-gray-400">Teléfono
            <input type="text" placeholder="Ej. +54 9 11..." value={phone} onChange={(event) => setPhone(event.target.value)} className={`mt-1.5 min-h-11 ${INPUT_CLASS}`} />
          </label>
          <label className="block text-xs font-semibold text-gray-400">Email
            <input type="email" placeholder="Ej. juan@mail.com" value={email} onChange={(event) => setEmail(event.target.value)} className={`mt-1.5 min-h-11 ${INPUT_CLASS}`} />
          </label>
          <label className="block text-xs font-semibold text-gray-400">Notas
            <input type="text" placeholder="Información interna" value={notes} onChange={(event) => setNotes(event.target.value)} className={`mt-1.5 min-h-11 ${INPUT_CLASS}`} />
          </label>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={handleClose} disabled={saving} className="min-h-11 rounded-xl border border-stampa-border text-sm font-bold text-gray-300 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stampa-orange text-sm font-black text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Guardar</button>
        </div>
      </div>
    </Dialog>
  );
}
