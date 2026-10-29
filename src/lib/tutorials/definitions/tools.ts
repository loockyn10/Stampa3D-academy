// Tutoriales de herramientas: Calculadora, Explorar Modelos, Librería STL y Stampa Maker.
// Contenido verificado contra calculadora/page.tsx, explorar-modelos, libreria-stl, stampa-maker y docs/PRODUCT.md §3, §17b, §18.

import type { TutorialDefinition } from "../types";

export const calculatorTutorial: TutorialDefinition = {
  id: "calculator",
  toolName: "Calculadora",
  title: "Cuánto cobrar por una impresión",
  description: "Calculá el precio con material, tiempo, margen y costos extra.",
  version: 1,
  steps: [
    {
      id: "datos",
      title: "Cargá los datos de la pieza",
      text: "Elegí el filamento y los gramos, el tiempo de impresión, el tipo de producto y la impresora.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "layers", label: "Filamento", hint: "y gramos" },
          { icon: "wrench", label: "Tiempo" },
          { icon: "package", label: "Tipo de producto" },
          { icon: "printer", label: "Impresora" },
        ],
      },
    },
    {
      id: "avanzado",
      title: "Sumá costos con el Modo Avanzado",
      text: "Agregá desperdicio, electricidad, mantenimiento, mano de obra, otros costos y los datos de la plataforma de venta.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "zap", title: "Material y taller", text: "Desperdicio, kWh, consumo" },
          { icon: "wrench", title: "Extras", text: "Mantenimiento, mano de obra" },
          { icon: "store", title: "Plataforma de venta", text: "Comisión, fijo y envío" },
        ],
      },
    },
    {
      id: "resultado",
      title: "Leé el resultado",
      text: "El costo base suma todos los costos. El precio sugerido es lo que conviene cobrar en una venta directa.",
      illustration: {
        kind: "breakdown",
        rows: ["Filamento", "Electricidad", "Mantenimiento", "Mano de obra", "Insumos extra"],
        subtotal: "Costo base",
        result: "Precio sugerido",
        note: "Ganancia estimada",
      },
    },
    {
      id: "guardar",
      title: "Guardá y ajustá",
      text: "Guardá el cálculo como producto y, en \"Configurar valores\", dejá tus costos fijos para todos los cálculos.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "package-plus", title: "Guardar como producto", text: "Lo suma a Mi Taller", tone: "accent" },
          { icon: "settings", title: "Configurar valores", text: "Electricidad, impresoras y más" },
        ],
      },
    },
  ],
};

export const modelSearchTutorial: TutorialDefinition = {
  id: "model_search",
  toolName: "Explorar Modelos",
  title: "Encontrá modelos 3D",
  description: "Buscá en varias plataformas desde un solo lugar. Cada resultado te lleva al modelo original.",
  version: 1,
  steps: [
    {
      id: "buscar",
      title: "Buscá por nombre",
      text: "Escribí lo que necesitás, en español o en inglés, y apretá Enter. Buscamos también en el otro idioma: “soporte notebook” encuentra modelos publicados como “laptop stand”, y lo ves indicado como búsqueda ampliada. Si una plataforma no responde, seguís viendo las demás. Tus últimas búsquedas quedan a mano.",
      illustration: {
        kind: "filters",
        search: "soporte notebook",
        groups: [{ label: "Fuente", options: ["Todas", "Cults3D", "MyMiniFactory"], active: "Todas" }],
      },
    },
    {
      id: "filtros",
      title: "Filtrá lo que importa",
      text: "Combiná fuente, precio y uso comercial, y ordená los resultados desde los desplegables. Cada filtro solo aparece si las plataformas elegidas lo admiten y, si una opción no está disponible, el desplegable te explica por qué. En el celular están en el botón Filtros.",
      illustration: {
        kind: "filters",
        search: "soporte auriculares",
        groups: [
          { label: "Precio", options: ["Todos", "Gratis", "De pago"], active: "Gratis" },
          { label: "Uso comercial", options: ["Todos", "Permitido"], active: "Permitido" },
        ],
      },
    },
    {
      id: "licencia",
      title: "Verificá siempre la licencia",
      text: "Gratis no significa uso comercial permitido. La fuente y la licencia se ven en cada resultado: revisalas en el sitio original.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "link", title: "Ver modelo en la fuente", text: "Siempre abre la página original", tone: "accent" },
          { icon: "file-text", title: "Licencia", text: "Verificala antes de vender" },
        ],
      },
    },
    {
      id: "calcular",
      title: "Calculá cuánto te costaría",
      text: "Desde un resultado podés abrir la Calculadora con el nombre del modelo para estimar tu precio.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "compass", label: "Modelo elegido" },
          { icon: "calculator", label: "Calcular en Stampa" },
        ],
      },
    },
  ],
};

export const stlLibraryTutorial: TutorialDefinition = {
  id: "stl_library",
  toolName: "Librería STL",
  title: "Modelos propios de Stampa",
  description: "Modelos listos para imprimir, organizados por grupos.",
  version: 1,
  steps: [
    {
      id: "grupos",
      title: "Explorá por grupos",
      text: "Cada grupo reúne modelos relacionados. También podés buscar por nombre de modelo o de grupo.",
      illustration: {
        kind: "filters",
        search: "Buscar modelos o grupos...",
        groups: [],
      },
    },
    {
      id: "detalle",
      title: "Mirá el modelo en 3D",
      text: "Cada modelo tiene un visor 3D interactivo, sus datos y las dimensiones del archivo.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "boxes", title: "Visor 3D", text: "Girá y mirá el modelo", tone: "accent" },
          { icon: "file-text", title: "Datos del modelo", text: "Metadata y dimensiones" },
        ],
      },
    },
    {
      id: "descargar",
      title: "Descargá el STL",
      text: "Descargá el archivo y llevalo a tu laminador. Las dimensiones se muestran en unidades del archivo.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "boxes", label: "Elegí un modelo" },
          { icon: "download", label: "Descargar STL" },
          { icon: "printer", label: "Imprimilo" },
        ],
      },
    },
  ],
};

export const makerTutorial: TutorialDefinition = {
  id: "maker",
  toolName: "Stampa Maker",
  title: "Generá piezas a medida",
  description: "Herramientas que crean geometría 3D imprimible a partir de parámetros simples.",
  version: 1,
  steps: [
    {
      id: "elegir",
      title: "Elegí una herramienta",
      text: "Cada herramienta resuelve un tipo de pieza distinto.",
      illustration: {
        kind: "cards",
        items: [
          { icon: "type", title: "Creador de Carteles", text: "Carteles, tapas y difusores", tone: "accent" },
          { icon: "zap", title: "Neon LED", text: "Canales para Neon Flex" },
        ],
      },
    },
    {
      id: "parametros",
      title: "Ajustá los parámetros",
      text: "Escribí tu texto o cargá un recorrido SVG y cambiá las medidas hasta que la pieza quede como la querés.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "type", label: "Texto o SVG" },
          { icon: "settings", label: "Parámetros" },
          { icon: "boxes", label: "Pieza 3D" },
        ],
      },
    },
    {
      id: "imprimir",
      title: "Descargá el STL e imprimí",
      text: "Cuando la pieza esté lista, descargá el STL y llevalo a tu laminador.",
      illustration: {
        kind: "flow",
        nodes: [
          { icon: "boxes", label: "Pieza lista" },
          { icon: "download", label: "Descargar STL" },
          { icon: "printer", label: "Imprimir" },
        ],
      },
    },
  ],
};
