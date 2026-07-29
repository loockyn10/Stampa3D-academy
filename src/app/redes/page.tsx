"use client";

import React from "react";
import { SectionTitle } from "@/components/ui/section-title";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";
import { Youtube, Instagram } from "@/components/ui/icons";
import { ShoppingBag } from "lucide-react";

export default function RedesPage() {
  const socialNetworks = [
    {
      name: "Instagram",
      description: "Contenido, novedades y avances de la comunidad.",
      buttonText: "Abrir Instagram",
      url: "https://instagram.com/extruye",
      icon: Instagram,
      color: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100",
    },
    {
      name: "TikTok",
      description: "Tips rápidos, clips y contenido corto sobre impresión 3D.",
      buttonText: "Abrir TikTok",
      url: "#",
      icon: () => (
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.59 4.23.99 1.25 2.45 2.1 4.05 2.38v3.96c-1.89-.01-3.75-.58-5.3-1.64-.17-.11-.32-.23-.47-.36v7.39c.01 4.05-2.22 7.73-5.83 9.48-3.6 1.76-7.96 1.19-11.02-1.42-3.07-2.61-4.22-6.9-2.91-10.74 1.3-3.83 5.09-6.38 9.15-6.37 1.48.01 2.96.34 4.31.98v4.02c-1.12-.55-2.36-.83-3.6-.8-2.6.08-4.88 1.94-5.39 4.49-.6 3 .95 6.03 3.75 7.15 2.8 1.12 6.05-.22 7.23-2.99.27-.64.39-1.34.38-2.04v-11.5z" />
        </svg>
      ),
      color: "bg-[#0a0a0a] text-white border-white/10",
    },
    {
      name: "YouTube",
      description: "Videos, tutoriales y contenido complementario de la academia.",
      buttonText: "Abrir YouTube",
      url: "https://youtube.com/extruye",
      icon: Youtube,
      color: "bg-red-50 text-red-600 border-red-100",
    },
    {
      name: "Tienda Online",
      description: "Accedé a productos, recursos o impresiones disponibles.",
      buttonText: "Abrir Tienda",
      url: "#",
      icon: ShoppingBag,
      color: "bg-orange-50 text-orange-600 border-orange-100",
    },
  ];

  return (
    <div className="pb-12 max-w-5xl">
      <SectionTitle eyebrow="Comunidad" title="Redes" />
      <p className="text-gray-500 text-sm -mt-3 mb-8">
        Seguinos en nuestras redes y encontrá contenido, novedades y recursos de Academia Stampa.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {socialNetworks.map((net) => {
          const Icon = net.icon;
          const isPlaceholder = net.url === "#";
          
          return (
            <Card key={net.name} className="p-6 flex flex-col justify-between border hover:shadow-md transition-shadow">
              <div>
                <div className={`w-12 h-12 flex items-center justify-center rounded-2xl border ${net.color} mb-4`}>
                  <Icon />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{net.name}</h3>
                <p className="text-sm text-gray-500 mb-6">{net.description}</p>
              </div>
              <div>
                <PrimaryButton 
                  href={net.url} 
                  target={isPlaceholder ? undefined : "_blank"} 
                  rel={isPlaceholder ? undefined : "noopener noreferrer"}
                  disabled={isPlaceholder}
                  className="w-full justify-center"
                >
                  {isPlaceholder ? "Próximamente" : net.buttonText}
                </PrimaryButton>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
