export type PaymentProviderName = "mercado_pago";

export interface PaymentCheckoutItem {
  reference: string;
  title: string;
  quantity: number;
  unitPrice: number;
  pictureUrl?: string | null;
}

export interface CreatePaymentCheckoutInput {
  externalReference: string;
  items: PaymentCheckoutItem[];
  payerEmail: string;
  marketplaceFee: number;
  expiresAt: string;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  notificationUrl: string;
}

export interface ProviderCheckout {
  id: string;
  initPoint: string;
  sandboxInitPoint: string | null;
  externalReference: string;
  raw: Record<string, unknown>;
}

export interface ProviderPayment {
  id: string;
  status: string;
  statusDetail: string | null;
  amount: number;
  refundedAmount: number;
  currency: string;
  externalReference: string | null;
  collectorId: string | null;
  approvedAt: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckout(input: CreatePaymentCheckoutInput): Promise<ProviderCheckout>;
  findCheckoutByExternalReference(externalReference: string): Promise<ProviderCheckout | null>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
}
