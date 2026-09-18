export interface BusinessCustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  contact_person: string | null;
  notes: string | null;
  fiscal_condition: string | null;
  cuit: string | null;
  is_active: boolean;
}

export interface BusinessCustomerOverview {
  clientId: string;
  name: string;
  phone: string | null;
  email: string | null;
  lastSaleAt: string | null;
  totalPurchased: number;
  balance: number;
}

export type CustomerLedgerMovementType = "sale_debt" | "payment" | "sale_reversal" | "adjustment";

export interface BusinessCustomerLedgerMovement {
  id: string;
  movement_type: CustomerLedgerMovementType;
  delta: number;
  sale_id: string | null;
  method: "cash" | "transfer" | null;
  note: string | null;
  reference: string | null;
  created_at: string;
}

function finiteMoney(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export function normalizeBusinessCustomerOverviewRow(row: {
  client_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  last_sale_at: string | null;
  total_purchased: number | string | null;
  balance: number | string | null;
}): BusinessCustomerOverview {
  return {
    clientId: row.client_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    lastSaleAt: row.last_sale_at,
    totalPurchased: finiteMoney(row.total_purchased),
    balance: finiteMoney(row.balance),
  };
}
