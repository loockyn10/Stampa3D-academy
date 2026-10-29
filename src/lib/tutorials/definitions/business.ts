// Tutoriales de Mi Negocio y Presupuestos. Contenido verificado contra business-dashboard, presupuestos y docs/PRODUCT.md §6-9.

import type { TutorialDefinition } from "../types";

export const businessTutorial: TutorialDefinition = {
  id: "business",
  toolName: "Mi Negocio",
  title: "Vendé y organizá tu negocio",
  description: "Mi Negocio es lo que se vende y cómo se opera: catálogo, ventas, clientes y tienda.",
  version: 1,
  steps: [
    {
      id: "catalogo",
      title: "Armá tu catálogo",
      text: "Vinculá productos fabricados en Mi Taller o cargá artículos de reventa, sin copiar recetas.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "package", title: "Fabricados", text: "Vienen de Mi Taller", tone: "accent" },
          { icon: "shopping-bag", title: "Reventa", text: "Artículos que comprás hechos" },
        ],
      },
    },
    {
      id: "vender",
      title: "Registrá una venta",
      text: "Venta rápida: escaneá o buscá el artículo y confirmá. Se descuenta el stock y se guarda el pago.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "barcode", label: "Escanear o buscar" },
          { icon: "receipt", label: "Confirmar venta" },
          { icon: "warehouse", label: "Descuenta stock" },
        ],
      },
    },
    {
      id: "clientes",
      title: "Clientes y presupuestos",
      text: "Llevá el historial y la cuenta corriente de cada cliente, y enviá presupuestos en PDF.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "users", title: "Clientes", text: "Historial, cuenta corriente y cobros" },
          { icon: "file-text", title: "Presupuestos", text: "Rápidos o profesionales" },
        ],
      },
    },
    {
      id: "tienda",
      title: "Tienda y métricas",
      text: "Publicá una vidriera con los productos que elijas y seguí tus ventas y más vendidos.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "store", title: "Mi Tienda", text: "Tu vidriera pública", tone: "accent" },
          { icon: "package-check", title: "Pedidos online", text: "Pagos y pedidos" },
          { icon: "chart", title: "Métricas", text: "Facturación y ticket" },
        ],
      },
    },
  ],
};

export const budgetsTutorial: TutorialDefinition = {
  id: "budgets",
  toolName: "Presupuestos",
  title: "Presupuestos para tus clientes",
  description: "Armá una propuesta, agregá productos y descargala en PDF.",
  version: 1,
  steps: [
    {
      id: "tipo",
      title: "Elegí el tipo de presupuesto",
      text: "El rápido es una cotización simple. El profesional suma datos fiscales, entrega, pago y condiciones.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "zap", title: "Presupuesto Rápido", text: "Cliente, productos, IVA y total", tone: "accent" },
          { icon: "file-text", title: "Presupuesto Profesional", text: "Presentación comercial completa" },
        ],
      },
    },
    {
      id: "armar",
      title: "Cliente y productos",
      text: "Elegí o creá el cliente y agregá los productos que vas a cotizar.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "user", label: "Cliente" },
          { icon: "package", label: "Productos" },
          { icon: "calculator", label: "Total" },
        ],
      },
    },
    {
      id: "pdf",
      title: "Descargá el PDF",
      text: "Cuando está listo, descargá el PDF para enviarlo a tu cliente.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "file-text", label: "Presupuesto" },
          { icon: "download", label: "Descargar PDF" },
        ],
      },
    },
  ],
};
