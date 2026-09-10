"use client";

import Link from "next/link";
import {
  ChartNoAxesCombined,
  Barcode,
  FileText,
  ReceiptText,
  PackageCheck,
  RefreshCcw,
  ShoppingBag,
  Store,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

const availableAreas = [
  {
    href: "/mi-negocio/catalogo",
    title: "Catálogo",
    description: "Organizá lo que fabricás y los productos que revendés sin mezclar sus costos ni recetas.",
    icon: ShoppingBag,
  },
  {
    href: "/mi-negocio/venta-rapida",
    title: "Venta rápida",
    description: "Escaneá o buscá productos, armá el carrito y descontá stock al confirmar.",
    icon: Barcode,
  },
  {
    href: "/mi-negocio/ventas",
    title: "Ventas",
    description: "Consultá operaciones registradas, clientes, artículos e importes.",
    icon: ReceiptText,
  },
  {
    href: "/mi-negocio/reposicion",
    title: "Reposición",
    description: "Completá tu showroom y revisá qué conviene volver a comprar.",
    icon: RefreshCcw,
  },
  {
    href: "/mi-negocio/metricas",
    title: "Métricas",
    description: "Revisá facturación, ventas, ticket promedio y los productos que más se venden.",
    icon: ChartNoAxesCombined,
  },
  {
    href: "/presupuestos",
    title: "Presupuestos",
    description: "Prepará propuestas rápidas o profesionales con tus productos y clientes.",
    icon: FileText,
  },
  {
    href: "/mi-negocio/tienda",
    title: "Mi Tienda",
    description: "Configurá y compartí una vidriera pública con los productos que elijas.",
    icon: Store,
  },
  {
    href: "/mi-negocio/pedidos",
    title: "Pedidos online",
    description: "Revisá compras iniciadas en tu tienda, pagos confirmados y pedidos que requieren atención.",
    icon: PackageCheck,
  },
] as const;

export default function MiNegocioPage() {
  const stampyContext: StampyScreenContext = {
    page: { section: "business", route: "/mi-negocio", title: "Mi Negocio" },
    mode: "hub",
    visibleEntities: availableAreas.map((area, index) => ({
      type: "business_area",
      id: area.title.toLowerCase(),
      name: area.title,
      position: index + 1,
    })),
    pageData: {
      kind: "pageFacts",
      facts: [
        { label: "Áreas disponibles", value: "Catálogo, Venta rápida, Ventas, Reposición, Métricas, Presupuestos, Mi Tienda y Pedidos online" },
      ],
    },
  };
  usePublishStampyScreenContext(stampyContext);

  return (
    <div className="pb-24">
      <SectionTitle eyebrow="Vender" title="Mi Negocio" />
      <p className="mb-7 max-w-2xl text-sm leading-6 text-gray-400">
        Tu espacio comercial está separado del taller: acá decidís qué ofrecés y a qué precio; las recetas y la producción siguen donde corresponden.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {availableAreas.map((area) => {
          const Icon = area.icon;
          return (
            <Link key={area.title} href={area.href} className="group min-w-0">
              <Card className="h-full p-5 transition-colors group-hover:border-stampa-orange/45 group-hover:bg-white/[0.035]">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-stampa-orange/20 bg-stampa-orange/10 text-stampa-orange">
                  <Icon size={21} />
                </span>
                <h2 className="text-base font-bold text-white">{area.title}</h2>
                <p className="mt-2 text-sm leading-5 text-gray-400">{area.description}</p>
                <p className="mt-5 text-xs font-bold text-stampa-orange">Abrir área →</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
