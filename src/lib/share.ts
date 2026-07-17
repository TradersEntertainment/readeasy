// Okuma paylaşımı: metin (+ gönderen adı ve notu) lz-string ile sıkıştırılır.
// İki taşıma yolu vardır:
//   #s=<kod>     → kısa link: payload Supabase'de durur (bkz. shortlink.ts)
//   #d=<payload> → uzun link: payload URL'in kendisindedir (sunucusuz yedek)

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Line } from "./doc";

// Uzun linkler pratikte ~100KB'a kadar çalışsa da güvenli tarafta kalıyoruz.
const MAX_SHARE_CHARS = 60_000;

export interface SharedDoc {
  title: string;
  text: string;
  sender?: string;
  note?: string;
}

// Paylaşım içeriğini sıkıştırılmış tek bir dizeye çevirir (iki yol da bunu taşır).
export function encodeSharePayload(
  title: string,
  lines: Line[],
  opts: { sender?: string; note?: string } = {},
): string | null {
  const text = lines
    .filter((l): l is Extract<Line, { kind: "text" }> => l.kind === "text")
    .map((l) => l.text)
    .join("\n");
  if (!text.trim() || text.length > MAX_SHARE_CHARS) return null;
  return compressToEncodedURIComponent(
    JSON.stringify({
      t: title,
      x: text,
      ...(opts.sender ? { s: opts.sender.slice(0, 60) } : {}),
      ...(opts.note ? { n: opts.note.slice(0, 280) } : {}),
    }),
  );
}

export function decodeSharePayload(payload: string): SharedDoc | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const obj = JSON.parse(raw) as {
      t?: unknown;
      x?: unknown;
      s?: unknown;
      n?: unknown;
    };
    if (typeof obj.x === "string" && obj.x.trim()) {
      return {
        title: typeof obj.t === "string" && obj.t ? obj.t : "Paylaşılan metin",
        text: obj.x,
        sender: typeof obj.s === "string" && obj.s ? obj.s : undefined,
        note: typeof obj.n === "string" && obj.n ? obj.n : undefined,
      };
    }
  } catch {
    // bozuk payload → yok say
  }
  return null;
}

export function longShareUrl(payload: string): string {
  return `${location.origin}${location.pathname}#d=${payload}`;
}

export function shortShareUrl(id: string): string {
  return `${location.origin}${location.pathname}#s=${id}`;
}

// Uzun link hash'i (#d=...) — senkron çözülür.
export function parseShareHash(): SharedDoc | null {
  const match = window.location.hash.match(/^#d=(.+)$/);
  return match ? decodeSharePayload(match[1]) : null;
}

// Kısa link hash'i (#s=...) — kodu döndürür, içerik sunucudan çekilir.
export function parseShortHashId(): string | null {
  const match = window.location.hash.match(/^#s=([A-Za-z0-9]{6,16})$/);
  return match ? match[1] : null;
}
