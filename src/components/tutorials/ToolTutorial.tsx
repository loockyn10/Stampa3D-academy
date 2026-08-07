"use client";

import React, { useState, useEffect } from "react";
import { HelpCircle, X, AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { ToolTutorial as ToolTutorialType, isPendingTutorialUrl, isBunnyEmbedUrl, getYoutubeEmbedUrl } from "@/types/tutorials";

interface ToolTutorialProps {
  toolKey: string;
  buttonLabel?: string;
  compact?: boolean;
}

export function ToolTutorial({ toolKey, buttonLabel = "? Tutorial", compact = false }: ToolTutorialProps) {
  const supabase = createClient();
  const [tutorial, setTutorial] = useState<ToolTutorialType | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  useEffect(() => {
    fetchTutorialData();
  }, [toolKey]);

  const fetchTutorialData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[ToolTutorial] No user found for toolKey: ${toolKey}`);
        }
        setLoading(false);
        return;
      }
      setUserId(user.id);

      // Fetch active tutorial for this tool
      const { data: tutData, error: tutError } = await supabase
        .from("tool_tutorials")
        .select("*")
        .eq("tool_key", toolKey)
        .eq("is_active", true)
        .maybeSingle();

      if (tutError && process.env.NODE_ENV === "development") {
        console.warn(`[ToolTutorial] Error fetching tool_tutorials:`, tutError);
      }

      if (tutData) {
        setTutorial(tutData);
        
        // Check if user has already viewed/dismissed it
        const { data: viewData, error: viewError } = await supabase
          .from("user_tool_tutorial_views")
          .select("*")
          .eq("user_id", user.id)
          .eq("tool_key", toolKey)
          .maybeSingle();

        if (viewError && process.env.NODE_ENV === "development") {
          console.warn(`[ToolTutorial] Error fetching user_tool_tutorial_views:`, viewError);
        }

        if (viewData && viewData.dismissed_at) {
          setIsDismissed(true);
        } else {
          // If no view record exists, open automatically (only once per session)
          if (!hasAutoOpened) {
            setShowModal(true);
            setHasAutoOpened(true);
          }
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[ToolTutorial] No active tutorial found for toolKey: ${toolKey}`);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[ToolTutorial] Unexpected error fetching data:", error);
      }
    }
    setLoading(false);
  };

  const handleClose = async () => {
    setShowModal(false);
    
    // If not already dismissed, save it to prevent auto-reopen
    if (!isDismissed && userId && tutorial) {
      try {
        const payload = {
          user_id: userId,
          tool_key: toolKey,
          viewed_at: new Date().toISOString(),
          dismissed_at: new Date().toISOString(),
        };
        
        const { error } = await supabase
          .from("user_tool_tutorial_views")
          .upsert([payload], { onConflict: "user_id,tool_key" });
          
        if (!error) {
          setIsDismissed(true);
        } else {
          if (process.env.NODE_ENV === "development") {
            console.warn("[ToolTutorial] Error upserting view state:", error);
          }
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[ToolTutorial] Unexpected error saving tutorial view state", e);
        }
      }
    }
  };

  const handleOpenManual = () => {
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="h-8 w-8 flex items-center justify-center opacity-50">
        <Loader2 size={16} className="animate-spin text-gray-500" />
      </div>
    );
  }

  // If there's no active tutorial, don't show the button
  if (!tutorial) {
    return null;
  }

  const youtubeEmbedUrl = getYoutubeEmbedUrl(tutorial.video_url);

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={handleOpenManual}
        title="Ver tutorial de esta herramienta"
        className={`flex items-center gap-1.5 bg-white/5 border border-white/10 hover:border-[#ff6a00]/40 text-neutral-200 rounded-full transition-colors ${
          compact ? "p-1.5" : "px-3 py-1.5 text-xs font-semibold"
        }`}
      >
        <HelpCircle size={compact ? 16 : 14} className={compact ? "" : "text-[#ff6a00]"} />
        {!compact && <span>{buttonLabel}</span>}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0a] w-full max-w-3xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#111]">
              <h3 className="font-bold text-white flex items-center gap-2">
                <HelpCircle size={18} className="text-[#ff6a00]" /> 
                {tutorial.title || "Tutorial de la herramienta"}
              </h3>
              <button 
                onClick={handleClose} 
                className="text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-1.5 rounded-full"
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

              <div className="rounded-xl overflow-hidden bg-[#111] border border-white/5 aspect-video w-full flex items-center justify-center relative">
                {isPendingTutorialUrl(tutorial.video_url) || !tutorial.video_url ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle size={40} className="text-[#ff6a00]/60 mb-3" />
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
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#ff6a00] hover:bg-[#ff7a1a] text-white font-bold rounded-xl transition-colors"
                    >
                      Ver video externo
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 bg-[#111] flex justify-end">
              <button
                onClick={handleClose}
                className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors"
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
