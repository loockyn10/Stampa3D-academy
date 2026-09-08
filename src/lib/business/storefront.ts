export const RESERVED_STOREFRONT_SLUGS = new Set([
  "admin", "api", "auth", "landing", "login", "registro", "stampy", "tienda", "mi-negocio",
]);

export interface BusinessStorefront {
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  whatsapp: string | null;
  public_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PublicStorefront {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  whatsapp: string | null;
  publicEmail: string | null;
}

export interface PublicStorefrontProduct {
  slug: string;
  name: string;
  category: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  available: boolean;
}

export interface PublicStorefrontCheckoutStatus {
  enabled: boolean;
  testMode: boolean;
}

export interface PublicBusinessOrder {
  orderNumber: number;
  orderStatus: string;
  paymentStatus: string;
  total: number;
  currency: string;
  buyerName: string;
  createdAt: string;
  expiresAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; subtotal: number }>;
}

export function normalizeStorefrontSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}

export function validateStorefrontSlug(value: unknown): string | null {
  const slug = normalizeStorefrontSlug(value);
  if (slug.length < 3) return "El slug debe tener al menos 3 caracteres.";
  if (RESERVED_STOREFRONT_SLUGS.has(slug)) return "Ese slug está reservado por Stampa.";
  return null;
}

export function normalizePublicWhatsapp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "").slice(0, 20);
  return digits.length >= 8 ? digits : null;
}

export function normalizePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().slice(0, 1000) : null;
  } catch { return null; }
}

export function buildWhatsappProductUrl(phone: string, productName: string, storeName: string): string {
  const message = `Hola, te consulto por ${productName} publicado en la tienda ${storeName} de Stampa.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

type RpcResult = { data: unknown; error: { message: string } | null };
interface PublicStorefrontClient { rpc(name: string, params: Record<string, unknown>): PromiseLike<RpcResult>; }

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

export async function loadPublicStorefront(client: PublicStorefrontClient, slugValue: string): Promise<PublicStorefront | null> {
  const slug = normalizeStorefrontSlug(slugValue);
  if (!slug) return null;
  const { data, error } = await client.rpc("get_public_business_storefront", { p_store_slug: slug });
  const row = firstRow(data);
  if (error || !row) return null;
  return {
    slug: String(row.store_slug), name: String(row.store_name),
    description: row.store_description ? String(row.store_description) : null,
    logoUrl: row.store_logo_url ? String(row.store_logo_url) : null,
    bannerUrl: row.store_banner_url ? String(row.store_banner_url) : null,
    whatsapp: row.store_whatsapp ? String(row.store_whatsapp) : null,
    publicEmail: row.store_public_email ? String(row.store_public_email) : null,
  };
}

export async function loadPublicStorefrontProducts(client: PublicStorefrontClient, slugValue: string): Promise<PublicStorefrontProduct[]> {
  const slug = normalizeStorefrontSlug(slugValue);
  if (!slug) return [];
  const { data, error } = await client.rpc("get_public_business_storefront_products", { p_store_slug: slug });
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    slug: String(row.product_slug), name: String(row.product_name), category: String(row.product_category),
    description: row.product_description ? String(row.product_description) : null,
    price: Number(row.product_price), imageUrl: row.product_image_url ? String(row.product_image_url) : null,
    available: row.product_available === true,
  }));
}

export async function loadPublicStorefrontProduct(client: PublicStorefrontClient, storeSlug: string, productSlug: string): Promise<PublicStorefrontProduct | null> {
  const { data, error } = await client.rpc("get_public_business_storefront_product", {
    p_store_slug: normalizeStorefrontSlug(storeSlug), p_product_slug: normalizeStorefrontSlug(productSlug),
  });
  const row = firstRow(data);
  if (error || !row) return null;
  return {
    slug: String(row.product_slug), name: String(row.product_name), category: String(row.product_category),
    description: row.product_description ? String(row.product_description) : null,
    price: Number(row.product_price), imageUrl: row.product_image_url ? String(row.product_image_url) : null,
    available: row.product_available === true,
  };
}

export async function loadPublicStorefrontCheckoutStatus(client: PublicStorefrontClient, slugValue: string): Promise<PublicStorefrontCheckoutStatus> {
  const slug = normalizeStorefrontSlug(slugValue);
  if (!slug) return { enabled: false, testMode: true };
  const { data, error } = await client.rpc("get_public_business_storefront_checkout_status", { p_store_slug: slug });
  const row = firstRow(data);
  if (error || !row) return { enabled: false, testMode: true };
  return { enabled: row.checkout_enabled === true, testMode: row.test_mode !== false };
}

export async function loadPublicBusinessOrder(client: PublicStorefrontClient, storeSlug: string, publicToken: string): Promise<PublicBusinessOrder | null> {
  const { data, error } = await client.rpc("get_public_business_order", {
    p_store_slug: normalizeStorefrontSlug(storeSlug), p_public_token: publicToken,
  });
  const row = firstRow(data);
  if (error || !row || !Array.isArray(row.items)) return null;
  return {
    orderNumber: Number(row.order_number), orderStatus: String(row.order_status), paymentStatus: String(row.payment_status),
    total: Number(row.total_amount), currency: String(row.currency), buyerName: String(row.buyer_name),
    createdAt: String(row.created_at), expiresAt: String(row.expires_at),
    items: row.items.map((item) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return { name: String(value.name), quantity: Number(value.quantity), unitPrice: Number(value.unitPrice), subtotal: Number(value.subtotal) };
    }),
  };
}
