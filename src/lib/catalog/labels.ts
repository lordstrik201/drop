import type { ProductStatus } from "@/lib/types";

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, [string, "success" | "neutral" | "warning"]> = {
  active: ["Ativo", "success"], draft: ["Rascunho", "warning"], inactive: ["Inativo", "neutral"], archived: ["Arquivado", "neutral"],
};
