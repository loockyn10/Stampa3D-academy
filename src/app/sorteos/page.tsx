"use client";

import React from "react";
import { CalendarDays, CheckCircle2, Gift, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { WINNERS } from "@/data/mock-data";

export default function SorteosPage() {
  return (
    <div className="space-y-8">
      <SectionTitle eyebrow="Comunidad" title="Sorteos" />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div className="flex items-center justify-center bg-orange-50 p-10 text-7xl select-none">
            🖨️
          </div>
          <div className="p-6">
            <div className="mb-2">
              <Badge tone="dark">Sorteo activo</Badge>
            </div>
            <h3 className="text-xl font-bold text-gray-900">Impresora Creality K2 Plus</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
              <CalendarDays size={14} /> Se sortea el 31 de julio de 2026
            </p>
            <p className="mt-3 text-sm text-gray-500">
              Participá completando cualquier curso del mes o compartiendo tu último proyecto en la comunidad de Telegram.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
              <li className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-orange-500" /> Ser miembro de la plataforma
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-orange-500" /> Completar al menos un curso este mes
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-orange-500" /> Estar en el canal de Telegram
              </li>
            </ul>
            <PrimaryButton className="mt-5">
              <Gift size={15} /> Quiero participar
            </PrimaryButton>
          </div>
        </div>
      </Card>

      <div>
        <SectionTitle eyebrow="Ediciones pasadas" title="Historial de ganadores" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {WINNERS.map((w) => (
            <Card key={w.name} className="p-4">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                <Trophy size={18} />
              </div>
              <p className="text-sm font-bold text-gray-900">{w.name}</p>
              <p className="text-xs text-gray-500">{w.prize}</p>
              <p className="mt-1 text-[11px] font-medium text-gray-400">{w.date}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
