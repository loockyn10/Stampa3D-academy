"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle, X, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { ToolTutorial as ToolTutorialType, isPendingTutorialUrl, isBunnyEmbedUrl, getYoutubeEmbedUrl } from "@/types/tutorials";

const routeToolMap = [
  { match: "/", toolKey: "dashboard", exact: true },
  { match: "/stampy", toolKey: "stampy" },
  { match: "/academia", toolKey: "courses" },
  { match: "/cursos", toolKey: "courses" },
  { match: "/talleres", toolKey: "courses" },
  { match: "/calculadora", toolKey: "calculator" },
  { match: "/presupuestos", toolKey: "budgets" },
  { match: "/productos", toolKey: "products" },
  { match: "/stock", toolKey: "stock" },
  { match: "/libreria-stl", toolKey: "stl_library" },
  { match: "/sorteos", toolKey: "raffles" },
  { match: "/configuracion", toolKey: "settings" }
];

export function GlobalToolTutorial({
  userId,
  mobileMenuOpen = false,
}: {
  userId: string | null;
  mobileMenuOpen?: boolean;
}) {
  const pathname = usePathname();
  const [supabase] = useState(() => createClient());
  
  const [toolKey, setToolKey] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState<ToolTutorialType | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [hasCheckedView, setHasCheckedView] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const [openSource, setOpenSource] = useState<"auto" | "manual" | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDev] = useState(process.env.NODE_ENV === "development");
  const [stampyTutorialBottom, setStampyTutorialBottom] = useState<number | null>(null);
  const isStampyRoute = pathname === "/stampy" || pathname.startsWith("/stampy/");

  useEffect(() => {
    if (!isStampyRoute) {
      setStampyTutorialBottom(null);
      return;
    }

    const composer = document.querySelector<HTMLElement>("[data-stampy-composer]");
    if (!composer) return;

    const updateTutorialPosition = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const composerTop = composer.getBoundingClientRect().top;
      setStampyTutorialBottom(Math.max(0, viewportHeight - composerTop + 12));
    };

    const resizeObserver = new ResizeObserver(updateTutorialPosition);
    resizeObserver.observe(composer);
    window.addEventListener("resize", updateTutorialPosition);
    window.visualViewport?.addEventListener("resize", updateTutorialPosition);
    updateTutorialPosition();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTutorialPosition);
      window.visualViewport?.removeEventListener("resize", updateTutorialPosition);
    };
  }, [isStampyRoute]);

  // Determine toolKey based on route
  useEffect(() => {
    if (!pathname) return;

    if (
      pathname.startsWith("/landing") ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/registro") ||
      pathname.startsWith("/sin-acceso") ||
      pathname.startsWith("/admin")
    ) {
      setToolKey(null);
      return;
    }

    let detectedKey: string | null = null;
    for (const route of routeToolMap) {
      if (route.exact) {
        if (pathname === route.match) {
          detectedKey = route.toolKey;
          break;
        }
      } else {
        if (pathname === route.match || pathname.startsWith(`${route.match}/`)) {
          detectedKey = route.toolKey;
          break;
        }
      }
    }
    
    setToolKey(detectedKey);
  }, [pathname]);

  // Fetch tutorial data when toolKey changes
  useEffect(() => {
    let mounted = true;

    async function fetchTutorial() {
      if (!toolKey) {
        if (mounted) {
          setTutorial(null);
          setView(null);
          setLoading(false);
          setHasCheckedView(false);
        }
        return;
      }

      try {
        if (mounted) {
          setLoading(true);
          setHasCheckedView(false);
        }

        if (!userId) {
          if (mounted) {
            setTutorial(null);
            setView(null);
            setLoading(false);
            setHasCheckedView(false);
          }
          return;
        }
        
        const [tutorialResult, viewResult] = await Promise.all([
          supabase
            .from("tool_tutorials")
            .select("id, tool_key, title, description, video_url, is_active")
            .eq("tool_key", toolKey)
            .eq("is_active", true)
            .maybeSingle(),
          supabase
            .from("user_tool_tutorial_views")
            .select("id, user_id, tool_key, viewed_at, dismissed_at")
            .eq("user_id", userId)
            .eq("tool_key", toolKey)
            .maybeSingle(),
        ]);

        const { data: tutData, error: tutError } = tutorialResult;

        if (tutError && isDev) {
          console.warn("[GlobalToolTutorial] Error fetching tool_tutorials:", tutError);
        }

        const { data: viewData, error: viewError } = viewResult;

        if (viewError && isDev) {
          console.warn("[GlobalToolTutorial] Error fetching view data:", viewError);
        }

        if (mounted) {
          setTutorial(tutData as ToolTutorialType | null);
          setView(viewData);
          setHasCheckedView(true);
          setLoading(false);
        }
      } catch (err: any) {
        if (isDev) {
          console.warn("[GlobalToolTutorial] Unexpected error:", err);
        }
        if (mounted) {
          setLoading(false);
        }
      }
    }

    // Reset state for new route/toolKey
    setTutorial(null);
    setView(null);
    setLoading(true);
    setOpen(false);
    setOpenSource(null);
    setHasAutoOpened(false);
    setHasCheckedView(false);

    fetchTutorial();

    return () => {
      mounted = false;
    };
  }, [toolKey, userId, supabase, isDev]);

  // Auto-open logic
  useEffect(() => {
    if (
      tutorial &&
      userId &&
      toolKey &&
      hasCheckedView &&
      !view &&
      !hasAutoOpened &&
      !mobileMenuOpen
    ) {
      setOpen(true);
      setOpenSource("auto");
      setHasAutoOpened(true);
    }
  }, [tutorial, userId, toolKey, view, hasCheckedView, hasAutoOpened, mobileMenuOpen]);

  const handleClose = async () => {
    setOpen(false);
    
    if (userId && toolKey && tutorial) {
      try {
        const payload = {
          user_id: userId,
          tool_key: toolKey,
          viewed_at: new Date().toISOString(),
          dismissed_at: new Date().toISOString(),
        };
        
        const { data: upsertData, error } = await supabase
          .from("user_tool_tutorial_views")
          .upsert([payload], { onConflict: "user_id,tool_key" })
          .select()
          .maybeSingle();
          
        if (!error) {
          setView(upsertData || payload);
        } else {
          if (isDev) console.warn("[GlobalToolTutorial] Error upserting view state:", error);
        }
      } catch (e: any) {
        if (isDev) console.warn("[GlobalToolTutorial] Unexpected error saving view state:", e);
      }
    }
  };

  const handleOpenManual = () => {
    setOpen(true);
    setOpenSource("manual");
  };

  if (!toolKey || !tutorial) {
    return null;
  }

  const youtubeEmbedUrl = getYoutubeEmbedUrl(tutorial.video_url);

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={handleOpenManual}
        title="Ver tutorial"
        aria-label="Abrir tutorial de esta página"
        style={stampyTutorialBottom !== null ? { "--stampy-tutorial-bottom": `${stampyTutorialBottom}px` } as React.CSSProperties : undefined}
        className={`mobile-floating-tutorial ${isStampyRoute ? "mobile-floating-tutorial-stampy" : ""} fixed z-[50] flex h-10 w-10 items-center justify-center rounded-full border border-stampa-orange/40 bg-stampa-orange text-lg font-bold text-white shadow-2xl shadow-stampa-orange/25 transition hover:scale-105 hover:bg-orange-400 active:scale-95 lg:z-[100] ${
          mobileMenuOpen ? "mobile-floating-action-hidden" : ""
        }`}
      >
        ?
      </button>


      {/* Modal */}
      {open && !mobileMenuOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stampa-bg/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-stampa-bg w-full max-w-3xl rounded-2xl border border-stampa-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-stampa-border">
              <h3 className="font-bold text-white flex items-center gap-2">
                <HelpCircle size={18} className="text-stampa-orange" /> 
                {tutorial.title || "Tutorial de la herramienta"}
              </h3>
              <button 
                onClick={handleClose} 
                className="text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-2 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content body */}
            <div className="p-6 overflow-y-auto space-y-4">
              {tutorial.description && (
                <p className="text-gray-300 text-sm">
                  {tutorial.description}
                </p>
              )}

              <div className="rounded-xl overflow-hidden bg-stampa-bg/50 border border-stampa-border aspect-video w-full flex items-center justify-center relative shadow-inner">
                {isPendingTutorialUrl(tutorial.video_url) || !tutorial.video_url ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle size={40} className="text-stampa-orange/60 mb-3 animate-pulse" />
                    <h4 className="text-white font-bold text-lg mb-1">Tutorial pendiente de cargar</h4>
                    <p className="text-gray-400 text-sm max-w-sm">
                      Cuando el video esté disponible, vas a poder verlo acá.
                    </p>
                  </div>
                ) : youtubeEmbedUrl ? (
                  <iframe 
                    src={youtubeEmbedUrl}
                    loading="lazy"
                    className="absolute top-0 left-0 w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : isBunnyEmbedUrl(tutorial.video_url) ? (
                  <iframe 
                    src={tutorial.video_url}
                    loading="lazy"
                    className="absolute top-0 left-0 w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <a 
                      href={tutorial.video_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-3 bg-stampa-orange hover:bg-stampa-orange-hover text-white font-bold rounded-xl transition-colors shadow-lg shadow-stampa-orange/20"
                    >
                      Ver video externo
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-stampa-border flex justify-end">
              <button
                onClick={handleClose}
                className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
