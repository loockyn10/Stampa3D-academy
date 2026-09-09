"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAppFeedback } from "@/components/ui/app-feedback";

interface XpRealtimeEvent {
  xp_awarded?: number;
  metadata?: {
    label?: string;
    oldLevel?: number;
    newLevel?: number;
  };
}

export function XpFeedbackListener() {
  const [supabase] = useState(() => createClient());
  const { toast } = useAppFeedback();

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      channel = supabase
        .channel(`xp-feedback-${data.user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "user_xp_events", filter: `user_id=eq.${data.user.id}` },
          (payload) => {
            const event = payload.new as XpRealtimeEvent;
            const amount = Number(event.xp_awarded) || 0;
            if (amount <= 0) return;
            const oldLevel = Number(event.metadata?.oldLevel) || 1;
            const newLevel = Number(event.metadata?.newLevel) || oldLevel;
            if (newLevel > oldLevel) {
              toast.success(`Nivel ${newLevel} · Llegaste a un nuevo nivel.`);
              return;
            }
            toast.success(`+${amount} XP · ${event.metadata?.label || "Actividad completada"}`);
          },
        )
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, toast]);

  return null;
}

