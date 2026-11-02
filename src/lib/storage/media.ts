import "server-only";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Upload de imagens para o Supabase Storage (bucket público "public-media",
 * criado pela migration 20261102000003). Usa a chave service_role, somente no
 * servidor. Tipos e tamanho são validados aqui e também pelo próprio bucket.
 */
export const MEDIA_BUCKET = "public-media";
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // limite de corpo da Vercel: 4,5 MB

export class MediaNotConfiguredError extends Error {
  constructor() {
    super("Envio de imagens indisponível: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. Enquanto isso, informe a URL https da imagem.");
  }
}

export function isMediaConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Confere a assinatura real do arquivo (não confia no tipo informado pelo navegador). */
export function sniffImageType(buf: Uint8Array): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /avi[fs]/.test(ascii(8, 12))) return "image/avif";
  return null;
}

export async function uploadImage(file: File, folder: string): Promise<{ url: string; path: string }> {
  if (!isMediaConfigured()) throw new MediaNotConfiguredError();
  if (file.size === 0) throw new Error("Arquivo vazio.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Imagem maior que 4 MB. Reduza a resolução ou use WebP.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(buf);
  if (!type) throw new Error("Formato não suportado. Use JPG, PNG, WebP ou AVIF.");
  const path = `${folder.replace(/[^\w/-]/g, "")}/${randomUUID()}.${TYPES[type]}`;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, buf, { contentType: type, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`Falha ao enviar a imagem: ${error.message}`);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function removeImage(path: string) {
  if (!isMediaConfigured() || !path) return;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw new Error(`Falha ao remover a imagem do armazenamento: ${error.message}`);
}
