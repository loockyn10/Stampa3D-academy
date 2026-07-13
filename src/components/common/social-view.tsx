"use client";

import React from "react";
import { Send, MessageCircle, ExternalLink } from "lucide-react";
import { Youtube, Instagram } from "@/components/ui/icons";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";

interface SocialInfo {
  icon: React.ComponentType<any>;
  name: string;
  desc: string;
  color: string;
  url: string;
}

const SOCIALS: Record<string, SocialInfo> = {
  telegram: {
    icon: Send,
    name: "Telegram",
    desc: "Sumate al canal para novedades, soporte de la comunidad y avisos de sorteos en tiempo real.",
    color: "bg-sky-50 text-sky-500",
    url: "https://t.me/extruye",
  },
  whatsapp: {
    icon: MessageCircle,
    name: "WhatsApp",
    desc: "Unite al grupo para consultas rápidas, compartir tus impresiones y ayuda entre miembros.",
    color: "bg-green-50 text-green-500",
    url: "https://chat.whatsapp.com/extruye",
  },
  youtube: {
    icon: Youtube,
    name: "YouTube",
    desc: "Mirá tutoriales gratuitos, reviews de impresoras y proyectos paso a paso.",
    color: "bg-red-50 text-red-500",
    url: "https://youtube.com/extruye",
  },
  instagram: {
    icon: Instagram,
    name: "Instagram",
    desc: "Inspirate con los proyectos de la comunidad y mostrá los tuyos.",
    color: "bg-fuchsia-50 text-fuchsia-500",
    url: "https://instagram.com/extruye",
  },
};

interface SocialViewProps {
  id: "telegram" | "whatsapp" | "youtube" | "instagram";
}

export function SocialView({ id }: SocialViewProps) {
  const s = SOCIALS[id];
  const Icon = s.icon;

  return (
    <div>
      <SectionTitle eyebrow="Comunidad" title={s.name} />
      <Card className="max-w-lg p-8 text-center mx-auto sm:mx-0">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${s.color}`}>
          <Icon size={28} />
        </div>
        <p className="text-lg font-bold text-gray-900">{s.name} de Academia Stampa</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">{s.desc}</p>
        <PrimaryButton href={s.url} target="_blank" rel="noopener noreferrer" className="mx-auto mt-5">
          Abrir {s.name} <ExternalLink size={14} />
        </PrimaryButton>
      </Card>
    </div>
  );
}
