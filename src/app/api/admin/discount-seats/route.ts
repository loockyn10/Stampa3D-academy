import { NextResponse } from "next/server";
import { requireAdminServiceClient } from "@/lib/admin/service-role-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export interface DiscountSeatsDto {
  invite_code_id: string;
  /** Paid uses: confirmed by the first approved payment. */
  confirmed: number;
  /** Seats held right now by an open checkout or an authorization still waiting for its first payment. */
  reserved: number;
  /** Of `reserved`: authorized at Mercado Pago, first payment pending or being retried. */
  reserved_authorized: number;
  /** null when the code has no limit. */
  available: number | null;
  over_limit: number;
}

/**
 * Seats per discount code for /admin/codigos (discount_code_seat_summary, migration 20261115120000). Admin only, service
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
    reserved: Number(row.reserved ?? 0),
    reserved_authorized: Number(row.reserved_authorized ?? 0),
    available: row.available === null || row.available === undefined ? null : Number(row.available),
    over_limit: Number(row.over_limit ?? 0),
  }));
  return NextResponse.json({ seats, available: true }, { headers: noStore });
}
