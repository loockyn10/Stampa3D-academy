import React from "react";
import { SinAccesoClient } from "./sin-acceso-client";

export default function SinAccesoPage() {
  const price = process.env.MEMBERSHIP_MONTHLY_PRICE || "15000";
  
  return <SinAccesoClient price={price} />;
}
