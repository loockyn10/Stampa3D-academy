import { NextResponse } from "next/server";
import { requireAdminServiceClient } from "@/lib/admin/service-role-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export interface DiscountSeatsDto {
  invite_code_id: string;
  /** Paid uses: confirmed by the first approved payment. The ONLY thing that consumes a seat. */
  confirmed: number;
  /** Checkouts open right now. Informational: they hold no seat (if they all paid, the code could pass its limit by this many). */
  in_flight: number;
  /** Of `in_flight`: authorized at Mercado Pago, first payment pending or being retried. */
  in_flight_authorized: number;
  /** max_uses - confirmed; null when the code has no limit. */
  available: number | null;
  /** Payers honoured beyond max_uses (their payment was already approved when the code was full). */
  over_limit: number;
}

/**
 * Seats per discount code for /admin/codigos (discount_code_seat_summary, migrations 20261115120000 + 20261116120000). Admin only, service
 * role, read-only. `available: false` while the migration is not applied: the page then keeps showing used_count.
 */
export async function GET() {
  const gate = await requireAdminServiceClient();
  if (!gate.admin) return gate.response;
  const { data, error } = await gate.admin.rpc("discount_code_seat_summary");
  if (error) return NextResponse.json({ seats: [], available: false }, { headers: noStore });
  const seats: DiscountSeatsDto[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    invite_code_id: String(row.invite_code_id),
    confirmed: Number(row.confirmed ?? 0),
    in_flight: Number(row.in_flight ?? 0),
    in_flight_authorized: Number(row.in_flight_authorized ?? 0),
    available: row.available === null || row.available === undefined ? null : Number(row.available),
    over_limit: Number(row.over_limit ?? 0),
  }));
  return NextResponse.json({ seats, available: true }, { headers: noStore });
}
