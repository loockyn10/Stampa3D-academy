"use client";

import React from "react";
import { LogOut } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PrimaryButton } from "@/components/ui/button";

export default function SalirPage() {
  return (
    <div className="flex items-center justify-center py-12">
      <Card className="mx-auto max-w-md p-8 text-center shadow-md">
        <LogOut size={28} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm font-semibold text-gray-900">Sesión cerrada</p>
        <p className="mt-1 text-xs text-gray-500">
          Esta es una vista de estructura; el login real se conectará más adelante.
        </p>
        <PrimaryButton href="/" className="mx-auto mt-5">
          Volver a entrar
        </PrimaryButton>
      </Card>
    </div>
  );
}
