"use client";

import { PrintersManager } from "@/components/configuracion/printers-manager";
import { SectionTitle } from "@/components/ui/section-title";

export default function WorkshopPrintersPage() {
  return (
    <div className="pb-24">
      <SectionTitle eyebrow="Mi Taller" title="Impresoras" />
      <p className="-mt-3 mb-6 max-w-2xl text-sm leading-6 text-gray-400">
        Administrá el equipamiento que usás para fabricar y calcular tus costos.
      </p>
      <PrintersManager />
    </div>
  );
}
