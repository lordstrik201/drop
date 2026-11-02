import type { Address } from "@/lib/types";

export type SupplierOrderInput = {
  supplierOrderId: string;
  idempotencyKey: string;
  orderNumber: number;
  customer: { name: string; email: string; phone: string | null; cpf: string | null };
  address: Address;
  items: { sku: string; supplierProductRef: string | null; supplierVariantRef: string | null; quantity: number; name: string }[];
  shippingMethod: string | null;
  config: Record<string, unknown>;
};

export type SupplierOrderResult =
  | { kind: "submitted"; externalOrderId: string; raw: unknown; costCents?: number }
  | { kind: "manual"; instructions: string };

export type SupplierTracking = {
  status: "pending" | "processing" | "shipped" | "delivered" | "canceled";
  carrier?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  events?: { at: Date; description: string; location?: string | null }[];
  raw?: unknown;
};

export type ImportedProduct = {
  externalId: string;
  name: string;
  description: string | null;
  images: string[];
  costCents: number;
  shippingCostCents: number | null;
  variants: { externalId: string; sku: string; title: string; options: Record<string, string>; costCents: number; stock: number | null; image?: string | null }[];
  raw?: unknown;
};

export class SupplierError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

/**
 * Contrato de um conector de fornecedor. Cada método só existe se a API oficial
 * do fornecedor oferecer o recurso; caso contrário, a operação é manual/CSV.
 */
export interface SupplierAdapter {
  readonly code: string;
  readonly label: string;
  /** Testa as credenciais. */
  ping?(): Promise<{ ok: boolean; message: string }>;
  createOrder?(input: SupplierOrderInput): Promise<SupplierOrderResult>;
  getTracking?(externalOrderId: string): Promise<SupplierTracking>;
  fetchProduct?(externalId: string): Promise<ImportedProduct>;
  fetchStock?(variantExternalIds: string[]): Promise<Record<string, number>>;
}
