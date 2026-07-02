import React, { useState, useMemo } from "react";
import {
  BookOpen, Gift, Calculator, Boxes, FileText, Package, Archive,
  Send, MessageCircle, Youtube, Instagram, User, Settings, LogOut,
  Search, Bell, ChevronRight, ChevronDown, Play, Clock, Layers,
  Download, Plus, Minus, Pencil, Copy, Trash2, TrendingUp,
  AlertTriangle, Menu, X, Lock, CheckCircle2, Circle, ArrowLeft,
  ExternalLink, Trophy, CalendarDays, Filter, Zap, DollarSign,
} from "lucide-react";

/* ============================================================
   DESIGN TOKENS
   Background:  #F7F7F9 (app), #FFFFFF (cards)
   Primary:     #FF6A00 (filament orange)
   Ink:         #1F2023 (headings), #6B7280 (body/secondary)
   Line:        #ECECEE
   Signature:   "spool" color chips — small filament-color dots that
   tag material/category across cards, nodding to filament spools.
   ============================================================ */

const SPOOL_COLORS = ["#FF6A00", "#1F2023", "#9CA3AF", "#16A34A", "#2563EB", "#DC2626"];

function SpoolDot({ i = 0, size = 8 }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: size, height: size, backgroundColor: SPOOL_COLORS[i % SPOOL_COLORS.length] }}
    />
  );
}

/* ============================================================
   MOCK DATA
   ============================================================ */

const COURSES = [
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

const STL_CATEGORIES = [
  { id: "figuras", name: "Figuras", icon: "🗿", count: 128 },
  { id: "herramientas", name: "Herramientas", icon: "🛠️", count: 64 },
  { id: "organizadores", name: "Organizadores", icon: "🗂️", count: 52 },
  { id: "repuestos", name: "Repuestos", icon: "⚙️", count: 41 },
  { id: "decoracion", name: "Decoración", icon: "🏺", count: 77 },
  { id: "accesorios", name: "Accesorios", icon: "📱", count: 39 },
  { id: "negocios", name: "Negocios imprimibles", icon: "💼", count: 23 },
];

const STL_FILES = [
  { id: "s1", name: "Organizador de tornillos modular", cat: "organizadores", badge: "Gratis", img: "🗄️" },
  { id: "s2", name: "Soporte para auriculares", cat: "accesorios", badge: "Gratis", img: "🎧" },
  { id: "s3", name: "Figura articulada dragón", cat: "figuras", badge: "Premium", img: "🐉" },
  { id: "s4", name: "Llavero personalizable", cat: "accesorios", badge: "Gratis", img: "🔑" },
  { id: "s5", name: "Engranaje repuesto extrusor", cat: "repuestos", badge: "Premium", img: "⚙️" },
  { id: "s6", name: "Maceta geométrica", cat: "decoracion", badge: "Gratis", img: "🪴" },
  { id: "s7", name: "Set de destornilladores mini", cat: "herramientas", badge: "Premium", img: "🪛" },
  { id: "s8", name: "Pack tarjetas de presentación 3D", cat: "negocios", badge: "Premium", img: "🪧" },
];

const WINNERS = [
  { name: "Martina G.", prize: "Impresora Bambu Lab A1 Mini", date: "Jun 2026" },
  { name: "Facundo R.", prize: "Kit de filamentos PLA x10", date: "May 2026" },
  { name: "Lucía P.", prize: "Voucher Librería STL Premium", date: "Abr 2026" },
];

const PRODUCTS_SEED = [
  { id: "p1", name: "Organizador de escritorio", cat: "Organizadores", material: "PLA", time: "6h", cost: 3200, price: 8500, stock: 14, img: "🗄️" },
  { id: "p2", name: "Maceta geométrica S", cat: "Decoración", material: "PETG", time: "3h 30m", cost: 1500, price: 4200, stock: 22, img: "🪴" },
  { id: "p3", name: "Llavero personalizado", cat: "Accesorios", material: "PLA", time: "45m", cost: 250, price: 1200, stock: 60, img: "🔑" },
  { id: "p4", name: "Soporte de celular articulado", cat: "Accesorios", material: "PETG", time: "2h 10m", cost: 900, price: 3100, stock: 8, img: "📱" },
];

const STOCK_PRODUCTS = [
  { name: "Organizador de escritorio", cat: "Producto", qty: 14, unit: "u", loc: "Estante A1", low: false },
  { name: "Maceta geométrica S", cat: "Producto", qty: 22, unit: "u", loc: "Estante A2", low: false },
  { name: "Llavero personalizado", cat: "Producto", qty: 4, unit: "u", loc: "Estante B1", low: true },
  { name: "Soporte de celular", cat: "Producto", qty: 8, unit: "u", loc: "Estante B2", low: false },
];
const STOCK_FILAMENTS = [
  { name: "PLA Naranja", cat: "Filamento", qty: 1.2, unit: "kg", loc: "Repisa 1", low: true, chip: 0 },
  { name: "PLA Negro", cat: "Filamento", qty: 3.8, unit: "kg", loc: "Repisa 1", low: false, chip: 1 },
  { name: "PETG Gris", cat: "Filamento", qty: 2.1, unit: "kg", loc: "Repisa 2", low: false, chip: 2 },
  { name: "PLA Verde", cat: "Filamento", qty: 0.4, unit: "kg", loc: "Repisa 2", low: true, chip: 3 },
];

const BUDGETS = [
  { id: "b1", client: "Juan Domínguez", items: "Organizador x2, Llavero x5", total: 22600, status: "Aprobado" },
  { id: "b2", client: "Comercio Norte SRL", items: "Soportes de celular x10", total: 31000, status: "Enviado" },
  { id: "b3", client: "María Sosa", items: "Maceta geométrica x3", total: 12600, status: "Borrador" },
  { id: "b4", client: "Estudio Diseño+", items: "Piezas a medida x1", total: 8400, status: "Rechazado" },
];

const STATUS_STYLES = {
  Aprobado: "bg-green-50 text-green-700 border-green-200",
  Enviado: "bg-blue-50 text-blue-700 border-blue-200",
  Borrador: "bg-gray-100 text-gray-600 border-gray-200",
  Rechazado: "bg-red-50 text-red-700 border-red-200",
};

const NAV = [
  {
    group: "Plataforma",
    items: [
      { id: "cursos", label: "Cursos", icon: BookOpen },
      { id: "sorteos", label: "Sorteos", icon: Gift },
      { id: "calculadora", label: "Calculadora", icon: Calculator },
      { id: "stl", label: "Librería STL", icon: Boxes },
    ],
  },
  {
    group: "Mi taller",
    items: [
      { id: "presupuestos", label: "Presupuestos", icon: FileText },
      { id: "productos", label: "Productos", icon: Package },
      { id: "stock", label: "Stock", icon: Archive },
    ],
  },
  {
    group: "Comunidad",
    items: [
      { id: "telegram", label: "Telegram", icon: Send },
      { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
      { id: "youtube", label: "YouTube", icon: Youtube },
      { id: "instagram", label: "Instagram", icon: Instagram },
    ],
  },
  {
    group: "Usuario",
    items: [
      { id: "perfil", label: "Mi perfil", icon: User },
      { id: "configuracion", label: "Configuración", icon: Settings },
      { id: "salir", label: "Cerrar sesión", icon: LogOut },
    ],
  },
];

const PAGE_TITLES = {
  inicio: "Inicio", cursos: "Cursos", sorteos: "Sorteos", calculadora: "Calculadora de costos",
  stl: "Librería STL", presupuestos: "Presupuestos", productos: "Productos", stock: "Stock",
  telegram: "Telegram", whatsapp: "WhatsApp", youtube: "YouTube", instagram: "Instagram",
  perfil: "Mi perfil", configuracion: "Configuración",
};

/* ============================================================
   SHARED UI
   ============================================================ */

function Badge({ children, tone = "orange", className = "" }) {
  const tones = {
    orange: "bg-orange-50 text-orange-600 border-orange-200",
    dark: "bg-gray-900 text-white border-gray-900",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
    green: "bg-green-50 text-green-700 border-green-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

function ProgressBar({ value, className = "" }) {
  return (
    <div className={`h-1.5 w-full rounded-full bg-gray-100 ${className}`}>
      <div
        className="h-1.5 rounded-full bg-orange-500 transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function SectionTitle({ eyebrow, title, action }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-500">{eyebrow}</p>}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function Card({ children, className = "", onClick }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-200 ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-orange-600 active:bg-orange-700 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/60 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-orange-500">
        <Icon size={22} />
      </div>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/* ============================================================
   SIDEBAR
   ============================================================ */

function Sidebar({ current, onNavigate, mobileOpen, setMobileOpen }) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-gray-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-100 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white">
              <Layers size={18} />
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-gray-900">Extruye</p>
              <p className="mt-0.5 text-[11px] leading-none text-gray-400">Academia 3D</p>
            </div>
          </div>
          <button className="text-gray-400 lg:hidden" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <button
          onClick={() => { onNavigate("inicio"); setMobileOpen(false); }}
          className={`mx-3 mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
            current === "inicio" ? "bg-orange-50 text-orange-600" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          <div className="flex h-5 w-5 items-center justify-center">🏠</div>
          Inicio
        </button>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((group) => (
            <div key={group.group} className="mb-5">
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {group.group}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = current === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                        active
                          ? "bg-orange-50 text-orange-600"
                          : item.id === "salir"
                          ? "text-gray-500 hover:bg-red-50 hover:text-red-600"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <Icon size={17} className={active ? "text-orange-500" : "text-gray-400 group-hover:text-gray-600"} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mx-3 mb-4 rounded-2xl bg-gray-900 p-4 text-white">
          <p className="text-xs font-semibold text-orange-400">Pasate a Premium</p>
          <p className="mt-1 text-xs text-gray-300">Desbloqueá todos los cursos y STL exclusivos.</p>
          <button className="mt-3 w-full rounded-lg bg-white/10 py-2 text-xs font-semibold hover:bg-white/20">
            Ver planes
          </button>
        </div>
      </aside>
    </>
  );
}

/* ============================================================
   HEADER
   ============================================================ */

function Header({ title, setMobileOpen }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-gray-100 bg-white/90 px-4 backdrop-blur lg:px-8">
      <button className="text-gray-500 lg:hidden" onClick={() => setMobileOpen(true)}>
        <Menu size={22} />
      </button>

      <h1 className="mr-2 hidden text-base font-bold text-gray-900 sm:block">{title}</h1>

      <div className="ml-auto flex flex-1 items-center gap-3 sm:ml-0">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar cursos, STL, productos..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
          />
        </div>
      </div>

      <button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-50">
        <Bell size={18} />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-orange-500" />
      </button>

      <button className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-gray-50">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600">
          MJ
        </div>
        <div className="hidden text-left sm:block">
          <p className="text-xs font-semibold leading-none text-gray-900">Marcos Juárez</p>
          <p className="mt-0.5 text-[11px] leading-none text-gray-400">Miembro Premium</p>
        </div>
        <ChevronDown size={14} className="hidden text-gray-400 sm:block" />
      </button>
    </header>
  );
}

/* ============================================================
   PAGE: INICIO (DASHBOARD)
   ============================================================ */

function InicioPage({ onNavigate, onOpenCourse }) {
  const continuing = COURSES.find((c) => c.progress > 0 && c.progress < 100);
  const stats = [
    { label: "Cursos iniciados", value: COURSES.filter((c) => c.progress > 0).length, icon: BookOpen },
    { label: "STL descargados", value: 27, icon: Download },
    { label: "Presupuestos creados", value: BUDGETS.length, icon: FileText },
  ];

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 p-6 text-white sm:p-8">
        <p className="text-sm font-medium text-orange-400">Hola, Marcos 👋</p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Sigamos imprimiendo ideas.</h2>
        <p className="mt-2 max-w-lg text-sm text-gray-300">
          Retomá tu curso, revisá el sorteo del mes o calculá el costo de tu próxima pieza.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <PrimaryButton onClick={() => continuing && onOpenCourse(continuing)}>
            <Play size={15} /> Continuar curso
          </PrimaryButton>
          <GhostButton className="bg-white/10 border-white/10 text-white hover:bg-white/20" onClick={() => onNavigate("calculadora")}>
            <Calculator size={15} /> Ir a la calculadora
          </GhostButton>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
              <s.icon size={20} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle
            eyebrow="Seguí aprendiendo"
            title="Continuar curso"
            action={<button onClick={() => onNavigate("cursos")} className="text-xs font-semibold text-orange-600 hover:underline">Ver todos</button>}
          />
          {continuing ? (
            <Card onClick={() => onOpenCourse(continuing)} className="flex items-center gap-4 p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-3xl">{continuing.img}</div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">{continuing.title}</p>
                <p className="text-xs text-gray-500">{continuing.lessons} lecciones · {continuing.duration}</p>
                <ProgressBar value={continuing.progress} className="mt-2" />
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </Card>
          ) : (
            <EmptyState icon={BookOpen} title="No tenés cursos en progreso" hint="Explorá el catálogo para empezar." />
          )}

          <SectionTitle
            eyebrow="Recién agregados"
            title="Últimos STL"
            action={<button onClick={() => onNavigate("stl")} className="text-xs font-semibold text-orange-600 hover:underline">Ver librería</button>}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STL_FILES.slice(0, 4).map((f) => (
              <Card key={f.id} className="p-3">
                <div className="flex h-16 items-center justify-center rounded-lg bg-gray-50 text-2xl">{f.img}</div>
                <p className="mt-2 truncate text-xs font-semibold text-gray-900">{f.name}</p>
                <Badge tone={f.badge === "Premium" ? "dark" : "green"}>{f.badge}</Badge>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle eyebrow="Este mes" title="Próximo sorteo" />
          <Card className="p-5">
            <div className="mb-3 flex h-28 items-center justify-center rounded-xl bg-orange-50 text-5xl">🎁</div>
            <p className="text-sm font-bold text-gray-900">Impresora Creality K2 Plus</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <CalendarDays size={13} /> Sorteo: 31 de julio
            </p>
            <PrimaryButton className="mt-4 w-full" onClick={() => onNavigate("sorteos")}>
              Ver bases y participar
            </PrimaryButton>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: CURSOS
   ============================================================ */

function CourseCard({ course, onOpen }) {
  return (
    <Card onClick={() => onOpen(course)} className="overflow-hidden p-0">
      <div className="relative flex h-36 items-center justify-center bg-gray-50 text-5xl">
        {course.img}
        <div className="absolute right-3 top-3">
          <Badge tone={course.badge === "Premium" ? "dark" : "green"}>{course.badge}</Badge>
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm font-bold leading-snug text-gray-900">{course.title}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Layers size={12} /> {course.lessons} lecciones</span>
          <span className="flex items-center gap-1"><Clock size={12} /> {course.duration}</span>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] font-medium text-gray-400">
            <span>Progreso</span><span>{course.progress}%</span>
          </div>
          <ProgressBar value={course.progress} />
        </div>
      </div>
    </Card>
  );
}

function CursosPage({ onOpen }) {
  return (
    <div>
      <SectionTitle eyebrow="Plataforma" title="Cursos" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {COURSES.map((c) => <CourseCard key={c.id} course={c} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function CursoDetailPage({ course, onBack }) {
  const [modules, setModules] = useState(course.modules);
  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Volver a cursos
      </button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-gray-900 text-6xl text-white">
            <Play size={44} className="opacity-80" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Badge tone={course.badge === "Premium" ? "dark" : "green"}>{course.badge}</Badge>
            <span className="text-xs text-gray-400">{course.lessons} lecciones · {course.duration}</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{course.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">{course.desc}</p>
        </div>

        <div>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">Progreso del curso</p>
              <span className="text-xs font-semibold text-orange-600">{course.progress}%</span>
            </div>
            <ProgressBar value={course.progress} className="mb-4" />
            <div className="space-y-1">
              {modules.map((m, i) => (
                <button
                  key={i}
                  disabled={m.locked}
                  onClick={() => setModules((prev) => prev.map((mm, idx) => idx === i ? { ...mm, done: !mm.done } : mm))}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    m.locked ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
                  }`}
                >
                  {m.locked ? (
                    <Lock size={16} className="text-gray-300" />
                  ) : m.done ? (
                    <CheckCircle2 size={16} className="text-orange-500" />
                  ) : (
                    <Circle size={16} className="text-gray-300" />
                  )}
                  <span className={`flex-1 ${m.done ? "text-gray-400 line-through" : "text-gray-700"}`}>{m.title}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: SORTEOS
   ============================================================ */

function SorteosPage() {
  return (
    <div className="space-y-8">
      <SectionTitle eyebrow="Comunidad" title="Sorteos" />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div className="flex items-center justify-center bg-orange-50 p-10 text-7xl">🖨️</div>
          <div className="p-6">
            <Badge tone="dark">Sorteo activo</Badge>
            <h3 className="mt-2 text-xl font-bold text-gray-900">Impresora Creality K2 Plus</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
              <CalendarDays size={14} /> Se sortea el 31 de julio de 2026
            </p>
            <p className="mt-3 text-sm text-gray-500">
              Participá completando cualquier curso del mes o compartiendo tu último proyecto en la comunidad de Telegram.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
              <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-orange-500" /> Ser miembro de la plataforma</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-orange-500" /> Completar al menos un curso este mes</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-orange-500" /> Estar en el canal de Telegram</li>
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

/* ============================================================
   PAGE: CALCULADORA
   ============================================================ */

function NumberField({ label, value, onChange, suffix, step = 1 }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 focus-within:border-orange-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-transparent py-2.5 text-sm text-gray-800 outline-none"
        />
        {suffix && <span className="text-xs font-medium text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

function CalculadoraPage() {
  const [advanced, setAdvanced] = useState(false);
  const [weight, setWeight] = useState(85);
  const [pricePerKg, setPricePerKg] = useState(9500);
  const [hours, setHours] = useState(3.5);

  const [kwh, setKwh] = useState(0.18);
  const [energyCost, setEnergyCost] = useState(120);
  const [wear, setWear] = useState(150);
  const [labor, setLabor] = useState(1000);
  const [margin, setMargin] = useState(35);
  const [taxes, setTaxes] = useState(10);
  const [other, setOther] = useState(0);

  const materialCost = (weight / 1000) * pricePerKg;

  const basicTotal = materialCost + hours * 200;

  const energyTotal = kwh * hours * energyCost;
  const wearTotal = wear * hours;
  const subtotal = materialCost + energyTotal + wearTotal + labor + other;
  const withMargin = subtotal * (1 + margin / 100);
  const advancedTotal = withMargin * (1 + taxes / 100);

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Calculadora de costos"
        action={
          <GhostButton onClick={() => setAdvanced((a) => !a)}>
            <Zap size={14} className={advanced ? "text-orange-500" : ""} />
            {advanced ? "Modo básico" : "Modo avanzado"}
          </GhostButton>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <p className="mb-4 text-sm font-bold text-gray-900">Datos de la pieza</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberField label="Peso de la pieza" value={weight} onChange={setWeight} suffix="g" />
            <NumberField label="Costo por kg de filamento" value={pricePerKg} onChange={setPricePerKg} suffix="$" />
            <NumberField label="Tiempo de impresión" value={hours} onChange={setHours} suffix="h" step={0.1} />
          </div>

          {advanced && (
            <>
              <div className="my-5 h-px bg-gray-100" />
              <p className="mb-4 text-sm font-bold text-gray-900">Costos avanzados</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberField label="Consumo energético" value={kwh} onChange={setKwh} suffix="kWh" step={0.01} />
                <NumberField label="Costo de electricidad" value={energyCost} onChange={setEnergyCost} suffix="$/kWh" />
                <NumberField label="Desgaste de impresora" value={wear} onChange={setWear} suffix="$/h" />
                <NumberField label="Mano de obra" value={labor} onChange={setLabor} suffix="$" />
                <NumberField label="Margen de ganancia" value={margin} onChange={setMargin} suffix="%" />
                <NumberField label="Impuestos" value={taxes} onChange={setTaxes} suffix="%" />
                <NumberField label="Otros gastos" value={other} onChange={setOther} suffix="$" />
              </div>
            </>
          )}
        </Card>

        <Card className="h-fit p-5">
          <p className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-900">
            <DollarSign size={16} className="text-orange-500" /> Resultado
          </p>

          {!advanced ? (
            <>
              <div className="flex items-center justify-between py-1.5 text-sm text-gray-500">
                <span>Costo de material</span><span className="font-semibold text-gray-800">${materialCost.toFixed(0)}</span>
              </div>
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between text-lg font-bold text-gray-900">
                <span>Total estimado</span><span className="text-orange-600">${basicTotal.toFixed(0)}</span>
              </div>
            </>
          ) : (
            <>
              {[
                ["Material", materialCost],
                ["Energía", energyTotal],
                ["Desgaste", wearTotal],
                ["Mano de obra", labor],
                ["Otros gastos", other],
              ].map(([label, val]) => (
                <div key={label} className="flex items-center justify-between py-1.5 text-sm text-gray-500">
                  <span>{label}</span><span className="font-semibold text-gray-800">${val.toFixed(0)}</span>
                </div>
              ))}
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between py-1 text-sm text-gray-500">
                <span>Subtotal</span><span>${subtotal.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between py-1 text-sm text-gray-500">
                <span>+ Margen ({margin}%)</span><span>${withMargin.toFixed(0)}</span>
              </div>
              <div className="my-3 h-px bg-gray-100" />
              <div className="flex items-center justify-between text-lg font-bold text-gray-900">
                <span>Total final</span><span className="text-orange-600">${advancedTotal.toFixed(0)}</span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: LIBRERÍA STL
   ============================================================ */

function StlPage() {
  const [category, setCategory] = useState(null);
  const [query, setQuery] = useState("");

  const files = useMemo(() => {
    let f = STL_FILES;
    if (category) f = f.filter((s) => s.cat === category);
    if (query) f = f.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
    return f;
  }, [category, query]);

  if (!category) {
    return (
      <div>
        <SectionTitle eyebrow="Plataforma" title="Librería STL" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {STL_CATEGORIES.map((c) => (
            <Card key={c.id} onClick={() => setCategory(c.id)} className="p-5 text-center">
              <div className="mb-2 text-4xl">{c.icon}</div>
              <p className="text-sm font-bold text-gray-900">{c.name}</p>
              <p className="text-xs text-gray-400">{c.count} modelos</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const catInfo = STL_CATEGORIES.find((c) => c.id === category);

  return (
    <div>
      <button onClick={() => { setCategory(null); setQuery(""); }} className="mb-4 flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
        <ArrowLeft size={14} /> Todas las categorías
      </button>
      <SectionTitle eyebrow="Librería STL" title={`${catInfo.icon} ${catInfo.name}`} />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar modelos..."
          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
        />
      </div>

      {files.length === 0 ? (
        <EmptyState icon={Boxes} title="No encontramos modelos" hint="Probá con otra búsqueda o categoría." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((f) => (
            <Card key={f.id} className="overflow-hidden p-0">
              <div className="relative flex h-28 items-center justify-center bg-gray-50 text-4xl">
                {f.img}
                <div className="absolute right-2 top-2">
                  <Badge tone={f.badge === "Premium" ? "dark" : "green"}>{f.badge}</Badge>
                </div>
              </div>
              <div className="p-3">
                <p className="truncate text-xs font-bold text-gray-900">{f.name}</p>
                <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2 text-xs font-semibold text-white hover:bg-gray-800">
                  <Download size={13} /> Descargar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PAGE: PRESUPUESTOS
   ============================================================ */

function PresupuestosPage() {
  const [showForm, setShowForm] = useState(false);
  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Presupuestos"
        action={<PrimaryButton onClick={() => setShowForm((s) => !s)}><Plus size={15} /> Nuevo presupuesto</PrimaryButton>}
      />

      {showForm && (
        <Card className="mb-6 p-5">
          <p className="mb-4 text-sm font-bold text-gray-900">Nuevo presupuesto</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Cliente</span>
              <input className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100" placeholder="Nombre del cliente" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Producto propio</span>
              <select className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100">
                <option>Seleccionar producto guardado...</option>
                {PRODUCTS_SEED.map((p) => <option key={p.id}>{p.name}</option>)}
              </select>
            </label>
            <NumberField label="Cantidad" value={1} onChange={() => {}} />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Material</span>
              <input className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100" placeholder="PLA, PETG..." />
            </label>
            <NumberField label="Tiempo de impresión" value={2} onChange={() => {}} suffix="h" />
            <NumberField label="Costo total" value={0} onChange={() => {}} suffix="$" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <PrimaryButton onClick={() => setShowForm(false)}><FileText size={15} /> Guardar presupuesto</PrimaryButton>
            <GhostButton onClick={() => setShowForm(false)}>Cancelar</GhostButton>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Detalle</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {BUDGETS.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3.5 font-semibold text-gray-900">{b.client}</td>
                  <td className="px-5 py-3.5 text-gray-500">{b.items}</td>
                  <td className="px-5 py-3.5 font-semibold text-gray-800">${b.total.toLocaleString("es-AR")}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[b.status]}`}>{b.status}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="text-xs font-semibold text-orange-600 hover:underline">Compartir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   PAGE: PRODUCTOS
   ============================================================ */

function ProductosPage() {
  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Productos"
        action={<PrimaryButton><Plus size={15} /> Nuevo producto</PrimaryButton>}
      />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS_SEED.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-2xl">{p.img}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-400">{p.cat}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                  <SpoolDot i={0} /> {p.material} · {p.time}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-2.5 text-center">
              <div><p className="text-xs font-bold text-gray-900">${p.cost}</p><p className="text-[10px] text-gray-400">Costo</p></div>
              <div><p className="text-xs font-bold text-orange-600">${p.price}</p><p className="text-[10px] text-gray-400">Venta</p></div>
              <div><p className="text-xs font-bold text-gray-900">{p.stock}</p><p className="text-[10px] text-gray-400">Stock</p></div>
            </div>
            <div className="mt-3 flex gap-2">
              <GhostButton className="flex-1 py-2 text-xs"><Pencil size={13} /> Editar</GhostButton>
              <GhostButton className="px-2.5 py-2"><Copy size={13} /></GhostButton>
              <GhostButton className="px-2.5 py-2 text-red-500 hover:bg-red-50"><Trash2 size={13} /></GhostButton>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: STOCK
   ============================================================ */

function StockTable({ rows, unitLabel }) {
  const [data, setData] = useState(rows);
  const adjust = (i, delta) => setData((prev) => prev.map((r, idx) => idx === i ? { ...r, qty: Math.max(0, +(r.qty + delta).toFixed(2)) } : r));

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-5 py-3">Nombre</th>
              <th className="px-5 py-3">Categoría</th>
              <th className="px-5 py-3">Cantidad</th>
              <th className="px-5 py-3">Ubicación</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((r, i) => (
              <tr key={r.name} className="hover:bg-gray-50">
                <td className="px-5 py-3.5 font-semibold text-gray-900">
                  <span className="flex items-center gap-2">
                    {r.chip !== undefined && <SpoolDot i={r.chip} />}
                    {r.name}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-gray-500">{r.cat}</td>
                <td className="px-5 py-3.5">
                  <span className={`font-semibold ${r.low ? "text-red-600" : "text-gray-800"}`}>{r.qty} {r.unit}</span>
                  {r.low && <Badge tone="gray" className="ml-2"><AlertTriangle size={11} /> Bajo</Badge>}
                </td>
                <td className="px-5 py-3.5 text-gray-500">{r.loc}</td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => adjust(i, -1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Minus size={13} /></button>
                    <button onClick={() => adjust(i, 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Plus size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StockPage() {
  const [tab, setTab] = useState("productos");
  const lowCount = [...STOCK_PRODUCTS, ...STOCK_FILAMENTS].filter((r) => r.low).length;

  return (
    <div>
      <SectionTitle
        eyebrow="Mi taller"
        title="Stock"
        action={<PrimaryButton><Plus size={15} /> Agregar item</PrimaryButton>}
      />

      {lowCount > 0 && (
        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          <AlertTriangle size={16} />
          Tenés {lowCount} {lowCount === 1 ? "ítem" : "ítems"} con stock bajo.
        </div>
      )}

      <div className="mb-5 inline-flex rounded-xl bg-gray-100 p-1">
        {[["productos", "Productos terminados"], ["filamentos", "Filamentos"]].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "productos" ? <StockTable rows={STOCK_PRODUCTS} /> : <StockTable rows={STOCK_FILAMENTS} />}
    </div>
  );
}

/* ============================================================
   PAGE: COMUNIDAD (redes)
   ============================================================ */

const SOCIALS = {
  telegram: { icon: Send, name: "Telegram", desc: "Sumate al canal para novedades, soporte de la comunidad y avisos de sorteos en tiempo real.", color: "bg-sky-50 text-sky-500" },
  whatsapp: { icon: MessageCircle, name: "WhatsApp", desc: "Unite al grupo para consultas rápidas, compartir tus impresiones y ayuda entre miembros.", color: "bg-green-50 text-green-500" },
  youtube: { icon: Youtube, name: "YouTube", desc: "Mirá tutoriales gratuitos, reviews de impresoras y proyectos paso a paso.", color: "bg-red-50 text-red-500" },
  instagram: { icon: Instagram, name: "Instagram", desc: "Inspirate con los proyectos de la comunidad y mostrá los tuyos.", color: "bg-fuchsia-50 text-fuchsia-500" },
};

function SocialPage({ id }) {
  const s = SOCIALS[id];
  const Icon = s.icon;
  return (
    <div>
      <SectionTitle eyebrow="Comunidad" title={s.name} />
      <Card className="max-w-lg p-8 text-center">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${s.color}`}>
          <Icon size={28} />
        </div>
        <p className="text-lg font-bold text-gray-900">{s.name} de Extruye</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">{s.desc}</p>
        <PrimaryButton className="mx-auto mt-5">
          Abrir {s.name} <ExternalLink size={14} />
        </PrimaryButton>
      </Card>
    </div>
  );
}

/* ============================================================
   PAGE: PERFIL / CONFIGURACIÓN (placeholders estructurales)
   ============================================================ */

function PerfilPage() {
  return (
    <div>
      <SectionTitle eyebrow="Usuario" title="Mi perfil" />
      <Card className="max-w-xl p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-600">MJ</div>
          <div>
            <p className="text-base font-bold text-gray-900">Marcos Juárez</p>
            <p className="text-sm text-gray-400">marcos@correo.com</p>
            <Badge tone="dark" className="mt-1">Miembro Premium</Badge>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Nombre</span>
            <input defaultValue="Marcos Juárez" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Email</span>
            <input defaultValue="marcos@correo.com" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100" />
          </label>
        </div>
        <PrimaryButton className="mt-5">Guardar cambios</PrimaryButton>
      </Card>
    </div>
  );
}

function ConfiguracionPage() {
  const rows = ["Notificaciones por email", "Notificaciones de sorteos", "Modo oscuro (próximamente)", "Recordatorios de cursos"];
  return (
    <div>
      <SectionTitle eyebrow="Usuario" title="Configuración" />
      <Card className="max-w-xl divide-y divide-gray-100 p-2">
        {rows.map((r) => (
          <div key={r} className="flex items-center justify-between px-4 py-3.5">
            <span className="text-sm text-gray-700">{r}</span>
            <div className="h-5 w-9 rounded-full bg-gray-200 p-0.5">
              <div className="h-4 w-4 rounded-full bg-white shadow" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */

export default function App() {
  const [page, setPage] = useState("inicio");
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigate = (id) => {
    setSelectedCourse(null);
    setPage(id);
  };

  const openCourse = (course) => {
    setSelectedCourse(course);
    setPage("cursos");
  };

  const title = selectedCourse ? selectedCourse.title : (PAGE_TITLES[page] || "");

  let content;
  if (page === "inicio") content = <InicioPage onNavigate={navigate} onOpenCourse={openCourse} />;
  else if (page === "cursos") content = selectedCourse
    ? <CursoDetailPage course={selectedCourse} onBack={() => setSelectedCourse(null)} />
    : <CursosPage onOpen={openCourse} />;
  else if (page === "sorteos") content = <SorteosPage />;
  else if (page === "calculadora") content = <CalculadoraPage />;
  else if (page === "stl") content = <StlPage />;
  else if (page === "presupuestos") content = <PresupuestosPage />;
  else if (page === "productos") content = <ProductosPage />;
  else if (page === "stock") content = <StockPage />;
  else if (["telegram", "whatsapp", "youtube", "instagram"].includes(page)) content = <SocialPage id={page} />;
  else if (page === "perfil") content = <PerfilPage />;
  else if (page === "configuracion") content = <ConfiguracionPage />;
  else if (page === "salir") content = (
    <Card className="mx-auto max-w-md p-8 text-center">
      <LogOut size={28} className="mx-auto mb-3 text-gray-300" />
      <p className="text-sm font-semibold text-gray-900">Sesión cerrada</p>
      <p className="mt-1 text-xs text-gray-500">Esta es una vista de estructura; el login real se conectará más adelante.</p>
      <PrimaryButton className="mx-auto mt-4" onClick={() => navigate("inicio")}>Volver a entrar</PrimaryButton>
    </Card>
  );

  return (
    <div className="flex min-h-screen bg-[#F7F7F9] font-sans">
      <Sidebar current={page} onNavigate={navigate} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="flex min-h-screen flex-1 flex-col lg:pl-0">
        <Header title={title} setMobileOpen={setMobileOpen} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {content}
        </main>
      </div>
    </div>
  );
}
