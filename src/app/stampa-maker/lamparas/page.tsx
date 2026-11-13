"use client";

import { LampEditor } from "@/components/maker/lamps/LampEditor";

/**
 * Generador de Lámparas E27 — editor visual (barra superior, biblioteca, visor 3D, propiedades y barra de componentes). La lógica y la composición están en
 * `components/maker/lamps/LampEditor`; la geometría, en `lib/maker/lamps`. La ruta sigue protegida por `layout.tsx` (Beta / solo administradores).
 */
export default function StampaMakerLampsPage() {
  return <LampEditor />;
}
