import type { Metadata } from "next";
import { FeatureUnavailable } from "@/components/features/feature-unavailable";
import { getFeatureDefinition, isFeatureId } from "@/lib/features/registry";

export const metadata: Metadata = {
  title: "Herramienta no disponible | Academia Stampa",
  robots: { index: false, follow: false },
};

export default async function NoDisponiblePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.herramienta) ? params.herramienta[0] : params.herramienta;
  // Solo se muestra un nombre que exista en el registro; cualquier otro valor se ignora.
  const featureName = isFeatureId(raw) ? getFeatureDefinition(raw).name : null;

  return <FeatureUnavailable featureName={featureName} />;
}
