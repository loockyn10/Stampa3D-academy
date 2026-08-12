"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle, X, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { ToolTutorial as ToolTutorialType, isPendingTutorialUrl, isBunnyEmbedUrl, getYoutubeEmbedUrl } from "@/types/tutorials";

const routeToolMap = [
  { match: "/", toolKey: "dashboard", exact: true },
  { match: "/stampy", toolKey: "stampy" },
  { match: "/cursos", toolKey: "courses" },
  { match: "/calculadora", toolKey: "calculator" },
  { match: "/presupuestos", toolKey: "budgets" },
  { match: "/productos", toolKey: "products" },
  { match: "/stock", toolKey: "stock" },
  { match: "/libreria-stl", toolKey: "stl_library" },
  { match: "/sorteos", toolKey: "raffles" },
  { match: "/configuracion", toolKey: "settings" }
];

export function GlobalToolTutorial() {
  const pathname = usePathname();
  const supabase = createClient();
  
  const [toolKey, setToolKey] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState<ToolTutorialType | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [hasCheckedView, setHasCheckedView] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const [openSource, setOpenSource] = useState<"auto" | "manual" | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDev] = useState(process.env.NODE_ENV === "development");

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

        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          if (mounted) {
            setTutorial(null);
            setView(null);
            setLoading(false);
            setHasCheckedView(false);
          }
          return;
        }
        
        if (mounted) {
          setUser(authUser);
          setUserId(authUser.id);
        }

        const { data: tutData, error: tutError } = await supabase
          .from("tool_tutorials")
          .select("id, tool_key, title, description, video_url, is_active")
          .eq("tool_key", toolKey)
          .eq("is_active", true)
          .maybeSingle();

        if (tutError && isDev) {
          console.warn("[GlobalToolTutorial] Error fetching tool_tutorials:", tutError);
        }

        const { data: viewData, error: viewError } = await supabase
          .from("user_tool_tutorial_views")
          .select("id, user_id, tool_key, viewed_at, dismissed_at")
          .eq("user_id", authUser.id)
          .eq("tool_key", toolKey)
          .maybeSingle();

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
  }, [toolKey, supabase, isDev]);

  // Auto-open logic
  useEffect(() => {
    if (
      tutorial &&
      user &&
      toolKey &&
      hasCheckedView &&
      !view &&
      !hasAutoOpened
    ) {
      setOpen(true);
      setOpenSource("auto");
      setHasAutoOpened(true);
    }
  }, [tutorial, user, toolKey, view, hasCheckedView, hasAutoOpened]);

  const handleClose = async () => {
    setOpen(false);
    
    if (user && toolKey && tutorial) {
      try {
        const payload = {
          user_id: user.id,
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
      <div className="fixed bottom-4 right-4 md:bottom-6 md:right-6 z-[90]">
        <button
          onClick={handleOpenManual}
          title="Ver tutorial"
          className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900/80 hover:bg-neutral-800 border border-white/10 hover:border-[#ff6a00]/40 text-neutral-100 rounded-full shadow-lg backdrop-blur-md transition-all hover:scale-105 active:scale-95"
        >
          <HelpCircle size={18} className="text-[#ff6a00]" />
          <span className="font-semibold text-sm">? Tutorial</span>
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-950 w-full max-w-3xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="font-bold text-white flex items-center gap-2">
                <HelpCircle size={18} className="text-[#ff6a00]" /> 
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

              <div className="rounded-xl overflow-hidden bg-black/50 border border-white/5 aspect-video w-full flex items-center justify-center relative shadow-inner">
                {isPendingTutorialUrl(tutorial.video_url) || !tutorial.video_url ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle size={40} className="text-[#ff6a00]/60 mb-3 animate-pulse" />
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
                      className="inline-flex items-center gap-2 px-6 py-3 bg-[#ff6a00] hover:bg-[#ff7a1a] text-white font-bold rounded-xl transition-colors shadow-lg shadow-orange-500/20"
                    >
                      Ver video externo
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex justify-end">
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
