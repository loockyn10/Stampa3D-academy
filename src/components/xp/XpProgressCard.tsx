"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Sparkles, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getXpProgress } from "@/lib/xp/progression";

export interface XpActivityItem {
  id: string;
  xpAwarded: number;
  label: string;
  createdAt: string;
}

export function XpProgressCard({
  totalXp,
  recentActivity = [],
}: {
  totalXp: number;
  recentActivity?: XpActivityItem[];
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const progress = useMemo(() => getXpProgress(totalXp), [totalXp]);

  return (
    <Card className="max-w-4xl overflow-hidden border-stampa-orange/25 bg-gradient-to-br from-stampa-orange/[0.09] via-stampa-surface to-violet-500/[0.06] p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-stampa-orange/25 bg-stampa-orange/10 text-stampa-orange">
          <Trophy size={26} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-stampa-orange">Tu progreso</p>
              <h2 className="mt-1 text-2xl font-black text-white">Nivel {progress.level}</h2>
            </div>
            <p className="text-sm font-bold text-gray-300"><span className="text-white">{progress.totalXp.toLocaleString("es-AR")}</span> XP totales</p>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full border border-white/5 bg-black/25" aria-label={`${Math.round(progress.progressPercent)}% del nivel actual`}>
            <div className="h-full rounded-full bg-gradient-to-r from-stampa-orange to-amber-300 transition-[width] duration-500" style={{ width: `${progress.progressPercent}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-500">
            <span>{progress.xpIntoLevel} / {progress.xpForNextLevel} XP en este nivel</span>
            <span>{progress.xpToNextLevel} XP para Nivel {progress.level + 1}</span>
          </div>
        </div>
      </div>

      {recentActivity.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <button type="button" onClick={() => setActivityOpen((value) => !value)} aria-expanded={activityOpen} className="flex min-h-10 w-full items-center justify-between rounded-xl px-2 text-left text-sm font-bold text-gray-300 hover:bg-white/[0.03]">
            <span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-stampa-orange" /> Ver actividad reciente</span>
            <ChevronDown size={16} className={`transition-transform ${activityOpen ? "rotate-180" : ""}`} />
          </button>
          {activityOpen && (
            <ul className="mt-2 grid gap-2">
              {recentActivity.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/10 px-3 py-2.5 text-xs">
                  <div className="min-w-0"><p className="truncate font-semibold text-gray-200">{event.label}</p><p className="mt-0.5 text-gray-600">{new Date(event.createdAt).toLocaleDateString("es-AR")}</p></div>
                  <span className="shrink-0 font-black text-stampa-orange">+{event.xpAwarded} XP</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

