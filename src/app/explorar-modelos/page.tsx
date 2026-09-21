import type { Metadata } from "next";
import { ExplorarModelosClient } from "@/components/explorar-modelos/ExplorarModelosClient";
import { describeProviders } from "@/lib/model-search/service";

// Se evalúa en cada request: qué fuentes están disponibles depende de credenciales server-side (sin exponerlas).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explorar Modelos 3D | Stampa",
  description: "Encontrá modelos 3D en distintas plataformas desde un solo lugar. Cada resultado te lleva al modelo original.",
};

export default function ExplorarModelosPage() {
  return <ExplorarModelosClient providers={describeProviders()} />;
}
