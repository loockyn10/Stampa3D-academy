"use client";

import React, { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";

export default function SalirPage() {
  const [message, setMessage] = useState("Cerrando sesión...");

  useEffect(() => {
    const supabase = createClient();
    
    const signOut = async () => {
      await supabase.auth.signOut();
      setMessage("Sesión cerrada. Redirigiendo...");
      setTimeout(() => {
        window.location.href = "/login";
      }, 1000);
    };

    signOut();
  }, []);

  return (
    <div className="flex items-center justify-center py-12 min-h-[50vh]">
      <Card className="mx-auto max-w-md p-8 text-center shadow-md">
        <LogOut size={28} className="mx-auto mb-3 text-gray-300 animate-pulse" />
        <p className="text-sm font-semibold text-gray-900">{message}</p>
      </Card>
    </div>
  );
}
