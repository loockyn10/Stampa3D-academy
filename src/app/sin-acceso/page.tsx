import React from "react";
import { SinAccesoClient } from "./sin-acceso-client";

export default async function SinAccesoPage({ searchParams }: PageProps<"/sin-acceso">) {
  const { feature } = await searchParams;
  return <SinAccesoClient feature={typeof feature === "string" ? feature : null} />;
}
