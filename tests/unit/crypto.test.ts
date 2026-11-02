import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret, safeEqual } from "@/lib/security/crypto";
import { redact } from "@/lib/logger";

describe("segredos", () => {
  it("cifra e decifra com AES-GCM", () => {
    const c = encryptSecret("APP_USR-123");
    expect(c).not.toContain("APP_USR");
    expect(decryptSecret(c)).toBe("APP_USR-123");
  });
  it("detecta adulteração", () => {
    const c = encryptSecret("x");
    const parts = c.split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("falha sem chave", () => {
    expect(() => encryptSecret("x", "")).toThrow(/APP_ENCRYPTION_KEY/);
  });
  it("mascara e compara em tempo constante", () => {
    expect(maskSecret("APP_USR-1234567890")).toBe("APP_****7890");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
  it("remove dados sensíveis dos logs", () => {
    expect(redact({ access_token: "x", nested: { cpf: "1", ok: 1 } })).toEqual({ access_token: "[redacted]", nested: { cpf: "[redacted]", ok: 1 } });
  });
});
