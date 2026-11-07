"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Monta un overlay modal directamente en <body>.
 *
 * Un `position: fixed` dentro de la página queda atado al primer ancestro con `transform`, `filter`, `perspective`,
 * `contain` o `will-change` (sin ir más lejos, un <main> con animación de entrada): el overlay deja de medir el
 * viewport y el modal se centra en el alto de toda la página, fuera de pantalla. Renderizarlo en <body> lo hace
 * independiente de cualquier ancestro y del scroll.
 *
 * Para diálogos nuevos preferir `Dialog` (ui/dialog.tsx), que además maneja foco, Escape y bloqueo de scroll.
 * Este componente existe para los modales históricos que traen su propio markup.
 */
const subscribeNothing = () => () => {};

export function ModalPortal({ children }: { children: ReactNode }) {
  // false en el servidor y en la hidratación, true en el cliente: sin setState dentro de un efecto.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
