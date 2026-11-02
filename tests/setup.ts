import { vi } from "vitest";

// "server-only" lança erro fora do bundler do Next; nos testes é inócuo.
vi.mock("server-only", () => ({}));
// headers()/cookies() não existem fora de uma requisição Next.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
