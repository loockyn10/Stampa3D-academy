// Tutoriales de Mi Taller. Contenido verificado contra el código (workshop-dashboard, printers-manager, stock, productos)
// y docs/PRODUCT.md §4. No agregar funciones que la pantalla no tenga.

import type { TutorialDefinition } from "../types";

export const workshopTutorial: TutorialDefinition = {
  id: "workshop",
  toolName: "Mi Taller",
  title: "Armá tu taller en 4 pasos",
  description: "Mi Taller es donde se fabrica: impresoras, bobinas, productos y unidades terminadas.",
  version: 1,
  steps: [
    {
      id: "equipo",
      title: "Cargá tu equipo",
      text: "Sumá tus impresoras y una card por cada bobina física. Con eso se calculan tus costos reales.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "printer", label: "Impresoras", hint: "Consumo y mantenimiento" },
          { icon: "layers", label: "Filamentos", hint: "Una card por bobina" },
        ],
      },
    },
    {
      id: "producto",
      title: "Creá un producto",
      text: "Un producto guarda su receta: material, tiempo y precio, con el mismo motor de la Calculadora.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "layers", label: "Material" },
          { icon: "wrench", label: "Receta y tiempo" },
          { icon: "calculator", label: "Costo y precio" },
          { icon: "package", label: "Producto", hint: "Listo para fabricar" },
        ],
      },
    },
    {
      id: "produccion",
      title: "Registrá lo que fabricás",
      text: "Registrar producción descuenta el filamento de la receta y suma unidades terminadas al inventario.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "clipboard-list", label: "Registrar producción" },
          { icon: "layers", label: "Descuenta filamento" },
          { icon: "warehouse", label: "Suma unidades terminadas" },
        ],
      },
    },
    {
      id: "resumen",
      title: "Mirá qué necesita atención",
      text: "El resumen te muestra productos sin stock, costos desactualizados y el estado de tus bobinas.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "package", title: "Productos registrados" },
          { icon: "warehouse", title: "Unidades terminadas" },
          { icon: "package-check", title: "Productos sin stock", tone: "accent" },
          { icon: "refresh", title: "Costos desactualizados", tone: "accent" },
        ],
      },
    },
  ],
};

export const printersTutorial: TutorialDefinition = {
  id: "printers",
  toolName: "Impresoras",
  title: "Tus impresoras",
  description: "El equipamiento que usás para fabricar y calcular costos.",
  version: 1,
  steps: [
    {
      id: "catalogo",
      title: "Elegí una del catálogo o cargá la tuya",
      text: "Importá un modelo desde el catálogo de Stampa o agregá una impresora manualmente.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "printer", title: "Catálogo Stampa", text: "Agregar a mis impresoras", tone: "accent" },
          { icon: "settings", title: "Carga manual", text: "Con tus propios datos" },
        ],
      },
    },
    {
      id: "datos",
      title: "Dos datos que afectan tus costos",
      text: "El consumo eléctrico y el mantenimiento por hora se suman al costo de cada impresión.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "zap", title: "Consumo (Watts)", text: "Electricidad por hora" },
          { icon: "wrench", title: "Mantenimiento ($/h)", text: "Desgaste de la máquina" },
        ],
      },
    },
    {
      id: "uso",
      title: "Se usan en toda la plataforma",
      text: "Tus impresoras aparecen al calcular precios y al armar productos.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "printer", label: "Mis impresoras" },
          { icon: "calculator", label: "Calculadora" },
          { icon: "package", label: "Productos" },
        ],
      },
    },
  ],
};

export const stockTutorial: TutorialDefinition = {
  id: "stock",
  toolName: "Filamentos e inventario",
  title: "Material y unidades terminadas",
  description: "Dos cosas distintas: las bobinas que tenés y los productos que ya fabricaste.",
  version: 1,
  steps: [
    {
      id: "bobinas",
      title: "Una bobina, una card",
      text: "Cada bobina física tiene su card con los gramos disponibles. Podés importarlas desde el catálogo.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "layers", title: "Bobina PLA", text: "Gramos disponibles", tone: "accent" },
          { icon: "layers", title: "Bobina PETG", text: "Gramos disponibles" },
          { icon: "download", title: "Importar desde catálogo" },
        ],
      },
    },
    {
      id: "descontar",
      title: "Descontá material sin fabricar",
      text: "\"Descontar por producto\" resta de tus bobinas lo que usó un producto, sin sumar unidades terminadas.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "package", label: "Descontar por producto" },
          { icon: "layers", label: "Resta filamento" },
        ],
      },
    },
    {
      id: "inventario",
      title: "Inventario: dos operaciones distintas",
      text: "Registrar producción consume la receta y suma unidades. Los controles manuales corrigen el conteo sin tocar el filamento.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "clipboard-list", title: "Registrar producción", text: "Consume material y suma unidades", tone: "accent" },
          { icon: "warehouse", title: "Ajuste manual", text: "Corrige el conteo, no descuenta filamento" },
        ],
      },
    },
  ],
};

export const productsTutorial: TutorialDefinition = {
  id: "products",
  toolName: "Productos",
  title: "Cómo se fabrica cada producto",
  description: "La receta de cada producto: material, tiempo, costos y precio.",
  version: 1,
  steps: [
    {
      id: "modo",
      title: "Simple o por partes",
      text: "Un producto simple se imprime de una vez. Uno por partes se arma con componentes que se fabrican por separado.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "package", title: "Producto simple", text: "Una receta" },
          { icon: "boxes", title: "Producto por partes", text: "Componentes con su propio stock", tone: "accent" },
        ],
      },
    },
    {
      id: "calculo",
      title: "Calculá el costo con tus datos",
      text: "El cálculo rápido usa tu impresora, tu material y el tipo de producto con el mismo motor de la Calculadora.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "printer", label: "Impresora" },
          { icon: "layers", label: "Material" },
          { icon: "calculator", label: "Costo base" },
          { icon: "sparkles", label: "Precio de venta" },
        ],
      },
    },
    {
      id: "recalcular",
      title: "Mantené los costos al día",
      text: "Si cambian tus costos, los productos afectados muestran \"Requiere Recalcular\". Podés recalcular uno o todos.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "refresh", title: "Requiere Recalcular", text: "Aviso en el producto", tone: "accent" },
          { icon: "calculator", title: "Recalcular todos", text: "Actualiza los precios" },
        ],
      },
    },
  ],
};
