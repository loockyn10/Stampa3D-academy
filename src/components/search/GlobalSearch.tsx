"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, GraduationCap, Wrench, Package, PenTool } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

// Tipos para los resultados de búsqueda
type SearchResultType = "tool" | "course" | "workshop";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: SearchResultType;
  path: string;
  keywords?: string[];
  thumbnail?: string;
}

// Lista estática de herramientas
const STATIC_TOOLS: SearchResult[] = [
  { id: "tool-academia", title: "Academia", description: "Cursos, talleres y rutas", type: "tool", path: "/academia", keywords: ["cursos", "talleres", "aprender", "clases"] },
  { id: "tool-cursos", title: "Cursos", description: "Aprende de forma estructurada", type: "tool", path: "/cursos", keywords: ["cursos", "aprender", "rutas"] },
  { id: "tool-talleres", title: "Talleres", description: "Proyectos prácticos", type: "tool", path: "/talleres", keywords: ["talleres", "proyectos", "práctica"] },
  { id: "tool-stampy", title: "Stampy", description: "Asistente de IA", type: "tool", path: "/stampy", keywords: ["ayuda", "ia", "preguntar", "problema"] },
  { id: "tool-calculadora", title: "Calculadora", description: "Calculá precios de impresión 3D", type: "tool", path: "/calculadora", keywords: ["precio", "costo", "calcular", "cobrar", "margen"] },
  { id: "tool-presupuestos", title: "Presupuestos", description: "Crea cotizaciones PDF", type: "tool", path: "/presupuestos", keywords: ["presupuesto", "cliente", "pdf", "cotizar"] },
  { id: "tool-productos", title: "Productos", description: "Catálogo de productos", type: "tool", path: "/productos", keywords: ["productos", "catalogo"] },
  { id: "tool-stock", title: "Stock", description: "Control de inventario", type: "tool", path: "/stock", keywords: ["filamento", "productos", "movimientos", "inventario"] },
  { id: "tool-stl", title: "Librería STL", description: "Modelos 3D", type: "tool", path: "/libreria-stl", keywords: ["stl", "descargar", "modelos", "archivos"] },
  { id: "tool-sorteos", title: "Sorteos", description: "Participá por premios", type: "tool", path: "/sorteos", keywords: ["sorteos", "premios", "ganar"] },
  { id: "tool-perfil", title: "Perfil", description: "Tu cuenta", type: "tool", path: "/perfil", keywords: ["perfil", "cuenta", "usuario"] },
  { id: "tool-config", title: "Configuración", description: "Ajustes de cuenta", type: "tool", path: "/configuracion", keywords: ["configuracion", "ajustes", "preferencias"] },
  { id: "tool-redes", title: "Redes", description: "Nuestras redes sociales", type: "tool", path: "/redes", keywords: ["redes", "sociales", "instagram", "youtube"] },
  { id: "tool-canales", title: "Canales", description: "Comunidades", type: "tool", path: "/canales", keywords: ["canales", "comunidad", "telegram", "whatsapp"] },
];

export function GlobalSearch() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [courses, setCourses] = useState<SearchResult[]>([]);
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);
  const coursesRequestRef = useRef<Promise<void> | null>(null);
  const coursesLoadedRef = useRef(false);

  // La navegación global no necesita cargar el catálogo hasta que el usuario busca.
  const ensureCoursesLoaded = () => {
    if (coursesLoadedRef.current || coursesRequestRef.current) return;

    coursesRequestRef.current = (async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, title, description, slug, course_kind, thumbnail_url")
        .eq("status", "published");

      if (data) {
        const mappedCourses: SearchResult[] = data.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description || "",
          type: c.course_kind === "workshop" ? "workshop" : "course",
          path: `/cursos/${c.slug || c.id}`,
          thumbnail: c.thumbnail_url
        }));
        setCourses(mappedCourses);
      }
      coursesLoadedRef.current = true;
    })().finally(() => {
      coursesRequestRef.current = null;
    });
  };

  // Cerrar al clickear afuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cerrar con Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Helper para normalizar texto (sacar acentos y pasar a lowercase)
  const normalize = (text: string) => {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  };

  // Filtrado de resultados
  const filteredResults = useMemo(() => {
    if (!searchTerm.trim()) return [];

    const term = normalize(searchTerm);
    const allItems = [...STATIC_TOOLS, ...courses];

    const results = allItems.filter((item) => {
      if (normalize(item.title).includes(term)) return true;
      if (normalize(item.description).includes(term)) return true;
      if (item.keywords && item.keywords.some((k) => normalize(k).includes(term))) return true;
      return false;
    });

    return results.slice(0, 8); // Máximo 8 resultados
  }, [searchTerm, courses]);

  // Manejar click en un resultado
  const handleSelectResult = (path: string) => {
    setIsOpen(false);
    setSearchTerm("");
    router.push(path);
  };

  // Helper de íconos/badges
  const getBadgeUI = (type: SearchResultType) => {
    switch (type) {
      case "tool":
        return {
          icon: <Wrench size={12} className="text-gray-400" />,
          label: "Herramienta",
          className: "bg-gray-500/10 text-gray-400 border-gray-500/20"
        };
      case "course":
        return {
          icon: <GraduationCap size={12} className="text-stampa-orange" />,
          label: "Curso",
          className: "bg-stampa-orange/10 text-stampa-orange border-[#ff6a00]/20"
        };
      case "workshop":
        return {
          icon: <PenTool size={12} className="text-sky-400" />,
          label: "Taller",
          className: "bg-sky-500/10 text-sky-400 border-sky-500/20"
        };
    }
  };

  return (
    <div className="relative w-full" ref={searchRef}>
      <div className="relative flex items-center w-full">
        <Search size={16} className="pointer-events-none absolute left-3 text-gray-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            ensureCoursesLoaded();
          }}
          placeholder="Buscar cursos, herramientas, talleres..."
          className="w-full rounded-xl border border-stampa-border bg-stampa-bg-soft py-2 pl-9 pr-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:bg-stampa-surface focus:border-[#ff6a00] focus:ring-[#ff6a00]/20 focus:ring-2 transition-all"
        />
      </div>

      {/* Dropdown de resultados */}
      {isOpen && searchTerm.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-stampa-border bg-stampa-surface shadow-2xl overflow-hidden z-50">
          {filteredResults.length > 0 ? (
            <ul className="max-h-[400px] overflow-y-auto py-2">
              {filteredResults.map((result) => {
                const badgeUI = getBadgeUI(result.type);
                return (
                  <li key={result.id}>
                    <button
                      onClick={() => handleSelectResult(result.path)}
                      className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-start gap-3 group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-bold text-white truncate group-hover:text-stampa-orange transition-colors">
                            {result.title}
                          </h4>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${badgeUI.className}`}>
                            {badgeUI.icon}
                            {badgeUI.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">
                          {result.description}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No encontramos resultados para "{searchTerm}".</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
