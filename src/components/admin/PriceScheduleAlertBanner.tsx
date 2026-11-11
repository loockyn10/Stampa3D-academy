"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

interface Summary {
  available: boolean;
  alert?: { level: string; message: string; daysLeft: number | null };
  attention?: number;
}

/**
 * Admin alert: the automatic price change is not validated/enabled while the first promotional subscriptions approach
 * their regular price, or some schedule needs a person. Renders nothing when there is nothing to say.
 */
export function PriceScheduleAlertBanner() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/price-schedules?summary=1", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && body) setSummary(body as Summary);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const level = summary?.alert?.level ?? "none";
  const attention = summary?.attention ?? 0;
  if (!summary?.available || (level === "none" && attention === 0)) return null;
  const urgent = level === "urgent" || level === "overdue";

  return (
    <div
      role="alert"
      data-testid="price-schedule-alert"
      className={`flex flex-col gap-2 rounded-2xl border p-4 text-sm sm:flex-row sm:items-start sm:justify-between ${
        urgent ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          {level !== "none" && <p>{summary.alert?.message}</p>}
          {attention > 0 && <p>{attention} suscripción(es) promocional(es) necesitan revisión.</p>}
        </div>
      </div>
      <Link href="/admin/promociones" className="shrink-0 font-semibold underline underline-offset-2">
        Ver promociones
      </Link>
    </div>
  );
}
