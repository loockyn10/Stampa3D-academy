import { Course, StlCategory, StlFile, Winner, Product, StockItem, Budget } from "@/types";

export const COURSES: Course[] = [
  {
    id: "c1", title: "Impresión 3D desde cero", lessons: 18, duration: "4h 20m",
    progress: 65, badge: "Disponible", img: "🖨️",
    desc: "Todo lo que necesitás saber para empezar a imprimir en 3D: tipos de impresoras, materiales, calibración y primeros modelos.",
    modules: [
      { title: "Introducción a la impresión 3D", done: true },
      { title: "Tipos de impresoras y tecnologías", done: true },
      { title: "Filamentos: PLA, PETG, ABS", done: true },
      { title: "Calibración de la mesa", done: false },
      { title: "Tu primera impresión", done: false, locked: true },
    ],
  },
  {
    id: "c2", title: "OrcaSlicer", lessons: 12, duration: "2h 45m",
    progress: 30, badge: "Premium", img: "🧩",
    desc: "Dominá OrcaSlicer: perfiles, soportes, multimaterial y ajustes avanzados de laminado.",
    modules: [
      { title: "Instalación y primeros pasos", done: true },
      { title: "Perfiles de impresión", done: false },
      { title: "Soportes y adhesión", done: false, locked: true },
      { title: "Multimaterial (AMS)", done: false, locked: true },
    ],
  },
  {
    id: "c3", title: "Bambu Lab desde cero", lessons: 15, duration: "3h 10m",
    progress: 0, badge: "Premium", img: "⚙️",
    desc: "Configurá y sacá el máximo provecho a tu impresora Bambu Lab, desde el unboxing hasta el mantenimiento.",
    modules: [
      { title: "Unboxing y primer encendido", done: false },
      { title: "Conexión y app Bambu Handy", done: false, locked: true },
      { title: "Mantenimiento preventivo", done: false, locked: true },
    ],
  },
  {
    id: "c4", title: "Diseño 3D con Fusion 360", lessons: 22, duration: "5h 50m",
    progress: 10, badge: "Premium", img: "📐",
    desc: "Aprendé a modelar tus propias piezas paramétricas listas para imprimir, desde cero.",
    modules: [
      { title: "Interfaz y navegación", done: true },
      { title: "Bocetos paramétricos", done: false },
      { title: "Modelado sólido", done: false, locked: true },
    ],
  },
  {
    id: "c5", title: "Costos y presupuestos para impresión 3D", lessons: 9, duration: "1h 55m",
    progress: 100, badge: "Disponible", img: "💰",
    desc: "Aprendé a calcular costos reales y armar presupuestos rentables para tu taller.",
    modules: [
      { title: "Costo de material", done: true },
      { title: "Costo de energía y desgaste", done: true },
      { title: "Armado de presupuestos", done: true },
    ],
  },
];

export const STL_CATEGORIES: StlCategory[] = [
  { id: "figuras", name: "Figuras", icon: "🗿", count: 128 },
  { id: "herramientas", name: "Herramientas", icon: "🛠️", count: 64 },
  { id: "organizadores", name: "Organizadores", icon: "🗂️", count: 52 },
  { id: "repuestos", name: "Repuestos", icon: "⚙️", count: 41 },
  { id: "decoracion", name: "Decoración", icon: "🏺", count: 77 },
  { id: "accesorios", name: "Accesorios", icon: "📱", count: 39 },
  { id: "negocios", name: "Negocios imprimibles", icon: "💼", count: 23 },
];

export const STL_FILES: StlFile[] = [
  { id: "s1", name: "Organizador de tornillos modular", cat: "organizadores", badge: "Gratis", img: "🗄️" },
  { id: "s2", name: "Soporte para auriculares", cat: "accesorios", badge: "Gratis", img: "🎧" },
  { id: "s3", name: "Figura articulada dragón", cat: "figuras", badge: "Premium", img: "🐉" },
  { id: "s4", name: "Llavero personalizable", cat: "accesorios", badge: "Gratis", img: "🔑" },
  { id: "s5", name: "Engranaje repuesto extrusor", cat: "repuestos", badge: "Premium", img: "⚙️" },
  { id: "s6", name: "Maceta geométrica", cat: "decoracion", badge: "Gratis", img: "🪴" },
  { id: "s7", name: "Set de destornilladores mini", cat: "herramientas", badge: "Premium", img: "🪛" },
  { id: "s8", name: "Pack tarjetas de presentación 3D", cat: "negocios", badge: "Premium", img: "🪧" },
];

export const WINNERS: Winner[] = [
  { name: "Martina G.", prize: "Impresora Bambu Lab A1 Mini", date: "Jun 2026" },
  { name: "Facundo R.", prize: "Kit de filamentos PLA x10", date: "May 2026" },
  { name: "Lucía P.", prize: "Voucher Librería STL Premium", date: "Abr 2026" },
];

export const PRODUCTS_SEED: Product[] = [
  { id: "p1", name: "Organizador de escritorio", cat: "Organizadores", material: "PLA", time: "6h", cost: 3200, price: 8500, stock: 14, img: "🗄️" },
  { id: "p2", name: "Maceta geométrica S", cat: "Decoración", material: "PETG", time: "3h 30m", cost: 1500, price: 4200, stock: 22, img: "🪴" },
  { id: "p3", name: "Llavero personalizado", cat: "Accesorios", material: "PLA", time: "45m", cost: 250, price: 1200, stock: 60, img: "🔑" },
  { id: "p4", name: "Soporte de celular articulado", cat: "Accesorios", material: "PETG", time: "2h 10m", cost: 900, price: 3100, stock: 8, img: "📱" },
];

export const STOCK_PRODUCTS: StockItem[] = [
  { name: "Organizador de escritorio", cat: "Producto", qty: 14, unit: "u", loc: "Estante A1", low: false },
  { name: "Maceta geométrica S", cat: "Producto", qty: 22, unit: "u", loc: "Estante A2", low: false },
  { name: "Llavero personalizado", cat: "Producto", qty: 4, unit: "u", loc: "Estante B1", low: true },
  { name: "Soporte de celular", cat: "Producto", qty: 8, unit: "u", loc: "Estante B2", low: false },
];

export const STOCK_FILAMENTS: StockItem[] = [
  { name: "PLA Naranja", cat: "Filamento", qty: 1.2, unit: "kg", loc: "Repisa 1", low: true, chip: 0 },
  { name: "PLA Negro", cat: "Filamento", qty: 3.8, unit: "kg", loc: "Repisa 1", low: false, chip: 1 },
  { name: "PETG Gris", cat: "Filamento", qty: 2.1, unit: "kg", loc: "Repisa 2", low: false, chip: 2 },
  { name: "PLA Verde", cat: "Filamento", qty: 0.4, unit: "kg", loc: "Repisa 2", low: true, chip: 3 },
];

export const BUDGETS: Budget[] = [
  { id: "b1", client: "Juan Domínguez", items: "Organizador x2, Llavero x5", total: 22600, status: "Aprobado" },
  { id: "b2", client: "Comercio Norte SRL", items: "Soportes de celular x10", total: 31000, status: "Enviado" },
  { id: "b3", client: "María Sosa", items: "Maceta geométrica x3", total: 12600, status: "Borrador" },
  { id: "b4", client: "Estudio Diseño+", items: "Piezas a medida x1", total: 8400, status: "Rechazado" },
];

export const STATUS_STYLES = {
  Aprobado: "bg-green-50 text-green-700 border-green-200",
  Enviado: "bg-blue-50 text-blue-700 border-blue-200",
  Borrador: "bg-gray-100 text-gray-600 border-gray-200",
  Rechazado: "bg-red-50 text-red-700 border-red-200",
};

export const SPOOL_COLORS = ["#FF6A00", "#1F2023", "#9CA3AF", "#16A34A", "#2563EB", "#DC2626"];
