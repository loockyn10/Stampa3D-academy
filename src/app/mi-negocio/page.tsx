"use client";

import Link from "next/link";
import {
  BadgeDollarSign,
  Barcode,
  Boxes,
  FileText,
  ReceiptText,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { usePublishStampyScreenContext } from "@/components/stampy/StampyContextProvider";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

const availableAreas = [
  {
    href: "/mi-negocio/venta-rapida",
    title: "Venta rápida",
    description: "Escaneá o buscá productos, armá el carrito y descontá stock al confirmar.",
    icon: Barcode,
  },
  {
    href: "/mi-negocio/catalogo",
    title: "Catálogo",
    description: "Organizá lo que fabricás y los productos que revendés sin mezclar sus costos ni recetas.",
    icon: ShoppingBag,
  },
  {
    href: "/mi-negocio/inventario",
    title: "Inventario",
    description: "Consultá unidades comerciales usando la fuente correcta para cada tipo de producto.",
    icon: Boxes,
  },
  {
    href: "/presupuestos",
    title: "Clientes",
    description: "Administrá clientes desde el flujo actual de presupuestos.",
    icon: Users,
  },
  {
    href: "/presupuestos",
    title: "Presupuestos",
    description: "Prepará propuestas rápidas o profesionales con tus productos y clientes.",
    icon: FileText,
  },
  {
    href: "/mi-negocio/ventas",
    title: "Ventas",
    description: "Consultá operaciones registradas, clientes, artículos e importes.",
    icon: ReceiptText,
  },
] as const;

const futureAreas = [
  { title: "Tienda pública", description: "Publicación online de una selección de tu catálogo.", icon: Store },
  { title: "Caja y métricas", description: "Ingresos, resultados y decisiones comerciales.", icon: BadgeDollarSign },
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
        { label: "Áreas disponibles", value: "Venta rápida, Catálogo, Inventario, Clientes, Presupuestos y Ventas" },
        { label: "Áreas futuras", value: "Tienda pública y métricas" },
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

      <div className="mt-9">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Próximas etapas</p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-gray-500">No disponibles todavía</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {futureAreas.map((area) => {
            const Icon = area.icon;
            return (
              <Card key={area.title} className="p-5 opacity-60">
                <Icon size={20} className="mb-3 text-gray-500" />
                <h2 className="text-sm font-bold text-gray-300">{area.title}</h2>
                <p className="mt-1.5 text-xs leading-5 text-gray-500">{area.description}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
