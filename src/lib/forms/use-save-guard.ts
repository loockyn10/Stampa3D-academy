"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Evita el doble envío de un guardado: mientras una operación está en vuelo, las siguientes se ignoran
 * (el ref bloquea de inmediato, el estado `saving` sirve para deshabilitar el botón y mostrar progreso).
 */
export function useSaveGuard() {
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  const runSave = useCallback(async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await operation();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);

  return { saving, runSave };
}
