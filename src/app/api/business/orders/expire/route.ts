import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createBusinessAdminClient } from "@/lib/business/server";

export const runtime = "nodejs";

function validCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  if (!validCronSecret(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data, error } = await createBusinessAdminClient().rpc("expire_business_orders");
  if (error) {
    console.error("[Business Orders] Falló la expiración", error.message);
    return NextResponse.json({ error: "No se pudieron expirar los pedidos" }, { status: 500 });
  }
  return NextResponse.json({ expiredOrders: Number(data || 0) });
}
