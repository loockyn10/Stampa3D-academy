export interface BillingFrequency {
  frequency: number;
  frequencyType: "months" | "days";
}

/** The commercial plan: one charge per month. */
export const MONTHLY_BILLING: BillingFrequency = { frequency: 1, frequencyType: "months" };

/**
 * Billing frequency for NEW checkouts. Production always bills monthly. Only an isolated test environment (Vercel
 * Preview / local development) may shorten the cycle with `MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS` (1–30) so a real
 * renewal can be observed with Mercado Pago test users without waiting a month. Anything else is ignored.
 */
export function resolveBillingFrequency(env: Record<string, string | undefined>): BillingFrequency {
  const raw = env.MEMBERSHIP_TEST_BILLING_FREQUENCY_DAYS;
  if (!raw) return MONTHLY_BILLING;

  const vercelEnv = env.VERCEL_ENV;
  const isolated = vercelEnv === "preview" || vercelEnv === "development" || (!vercelEnv && env.NODE_ENV === "development");
  if (vercelEnv === "production" || !isolated) return MONTHLY_BILLING;

  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 30) return MONTHLY_BILLING;
  return { frequency: days, frequencyType: "days" };
}
