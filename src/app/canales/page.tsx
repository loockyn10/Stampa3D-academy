"use client";

import React from "react";
import { SectionTitle } from "@/components/ui/section-title";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { Send, MessageCircle } from "lucide-react";

export default function CanalesPage() {
  const channels = [
    {
      name: "WhatsApp",
      description: "Canal o grupo para avisos, consultas rápidas y comunidad.",
      buttonText: "Abrir WhatsApp",
      url: "https://chat.whatsapp.com/extruye",
      icon: MessageCircle,
      color: "bg-green-50 text-green-600 border-green-100",
    },
    {
      name: "Telegram",
      description: "Canal o grupo alternativo para novedades y comunidad.",
      buttonText: "Abrir Telegram",
      url: "https://t.me/extruye",
      icon: Send,
      color: "bg-sky-50 text-sky-600 border-sky-100",
    },
  ];

  return (
    <div className="pb-12 max-w-5xl">
      <SectionTitle eyebrow="Comunidad" title="Canales" />
      <p className="text-gray-500 text-sm -mt-3 mb-8">
        Entrá a los canales de comunidad para resolver dudas, compartir avances y estar al día.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {channels.map((chan) => {
          const Icon = chan.icon;
          
          return (
            <Card key={chan.name} className="p-6 flex flex-col justify-between border hover:shadow-md transition-shadow">
              <div>
                <div className={`w-12 h-12 flex items-center justify-center rounded-2xl border ${chan.color} mb-4`}>
                  <Icon size={24} />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{chan.name}</h3>
                <p className="text-sm text-gray-500 mb-6">{chan.description}</p>
              </div>
              <div>
                <PrimaryButton 
                  href={chan.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full justify-center"
                >
                  {chan.buttonText}
                </PrimaryButton>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
