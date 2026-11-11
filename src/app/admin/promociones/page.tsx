"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PriceScheduleAlertBanner } from "@/components/admin/PriceScheduleAlertBanner";

interface Row {
  id: string;
  userId: string;
  email: string | null;
  status: string;
  promoPrice: number;
  postPrice: number;
  promoEndsAt: string | null;
  noticeEmailSentAt: string | null;
  attempts: number;
  lastError: string | null;
}

interface Payload {
  available: boolean;
  flags: { schedulesEnabled: boolean; stepUpEnabled: boolean; noticeMailerConfigured: boolean; alertEmailConfigured: boolean };
  counts?: Record<string, number>;
  alert?: { level: string; message: string; daysLeft: number | null };
  schedules?: Row[];
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Promoción en curso",
  applied: "Cambio aplicado",
  needs_review: "Necesita revisión",
  needs_reauth: "Requiere reautorización",
  failed: "Falló (reintentos agotados)",
  void: "Cancelada",
};

const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("es-AR") : "—");

function Flag({ label, on, hint }: { label: string; on: boolean; hint: string }) {
  return (
    <div className="rounded-xl border border-stampa-border bg-stampa-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${on ? "text-green-400" : "text-amber-300"}`}>{on ? "Activo" : "Apagado"}</p>
      <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

export default function AdminPromocionesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/price-schedules", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No pudimos cargar las promociones.");
        return (await response.json()) as Payload;
      })
      .then((body) => active && setData(body))
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : "Error"));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link href="/admin" className="font-medium text-orange-400 hover:text-orange-300">Admin</Link>
          <span className="text-gray-600">/</span>
          <span className="text-gray-500">Promociones</span>
        </div>
        <h1 className="text-2xl font-bold text-fg">Promociones por períodos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Estado de cada suscripción promocional (precio especial durante N períodos mensuales y luego el precio aceptado). Solo lectura.
        </p>
      </div>

      <PriceScheduleAlertBanner />

      {!data && !error && (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>
      )}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Flag label="Agendas de precio" on={data.flags.schedulesEnabled} hint="PRICE_SCHEDULES_ENABLED: permite contratar con condiciones y registra las fechas." />
            <Flag label="Cambio automático de importe" on={data.flags.stepUpEnabled} hint="PRICE_STEP_UP_ENABLED: único que permite modificar el importe en Mercado Pago." />
            <Flag label="Correo al cliente" on={data.flags.noticeMailerConfigured} hint="RESEND_API_KEY + PRICE_NOTICE_FROM. Sin correo no se sube el precio." />
            <Flag label="Alertas al administrador" on={data.flags.alertEmailConfigured} hint="PRICE_ALERT_EMAIL. Sin él las alertas solo se ven acá y en los logs." />
          </div>

          {!data.available ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              Todavía no se aplicó la migration de agendas de precio: no hay datos para mostrar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(data.counts ?? {}).map(([status, count]) => (
                  <span key={status} className="rounded-full border border-stampa-border bg-fg/5 px-3 py-1 text-gray-300">
                    {STATUS_LABEL[status] ?? status}: <strong>{count}</strong>
                  </span>
                ))}
                {Object.keys(data.counts ?? {}).length === 0 && <span className="text-gray-500">Todavía no hay suscripciones promocionales.</span>}
              </div>

              <div className="overflow-x-auto rounded-xl border border-stampa-border bg-stampa-surface">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-stampa-border bg-stampa-bg-soft text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Precio</th>
                      <th className="px-4 py-3">Fin de la promoción</th>
                      <th className="px-4 py-3">Aviso por correo</th>
                      <th className="px-4 py-3">Intentos</th>
                      <th className="px-4 py-3">Último error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fg/5">
                    {(data.schedules ?? []).map((row) => (
                      <tr key={row.id} className="text-gray-300">
                        <td className="px-4 py-3">{row.email ?? row.userId.slice(0, 8)}</td>
                        <td className="px-4 py-3">{STATUS_LABEL[row.status] ?? row.status}</td>
                        <td className="px-4 py-3">{money(row.promoPrice)} → {money(row.postPrice)}</td>
                        <td className="px-4 py-3">{date(row.promoEndsAt)}</td>
                        <td className="px-4 py-3">{date(row.noticeEmailSentAt)}</td>
                        <td className="px-4 py-3">{row.attempts}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{row.lastError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
