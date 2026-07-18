// Okuma paylaşımı: içerik (+ gönderen adı ve notu) lz-string ile sıkıştırılır.
// İki taşıma yolu vardır:
//   #s=<kod>     → kısa link: payload Supabase'de durur (bkz. shortlink.ts).
//                  Görseller ve tablolar dahil TÜM akış taşınabilir.
//   #d=<payload> → uzun link: payload URL'in kendisindedir (sunucusuz yedek).
//                  Görseller URL'e sığmayacağı için yalnızca metin taşınır.
//
// Payload biçimleri: { t, x, s?, n? } yalnız metin (eski linklerle uyumlu),
// { t, l, s?, n? } tam satır listesi (metin + görsel + tablo).

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Line } from "./doc";
import { splitIntoLines } from "./text";
import { sanitizeTableHtml } from "./sanitize";

// Uzun linkler pratikte ~100KB'a kadar çalışsa da güvenli tarafta kalıyoruz.
const MAX_TEXT_CHARS = 60_000;
// Görselli payload sınırı (sıkıştırılmış karakter, ~3-4 MB) — Supabase
// tablosundaki check kısıtıyla uyumlu tutun (README).
const MAX_RICH_PAYLOAD = 4_000_000;

export interface SharedDoc {
  title: string;
  lines: Line[];
  sender?: string;
  note?: string;
}

export function encodeSharePayload(
  title: string,
  lines: Line[],
  opts: { sender?: string; note?: string } = {},
  includeMedia = false,
): string | null {
  const meta = {
    ...(opts.sender ? { s: opts.sender.slice(0, 60) } : {}),
    ...(opts.note ? { n: opts.note.slice(0, 280) } : {}),
  };

  if (includeMedia && lines.some((l) => l.kind !== "text")) {
    const payload = compressToEncodedURIComponent(
      JSON.stringify({ t: title, l: lines, ...meta }),
    );
    return payload.length <= MAX_RICH_PAYLOAD ? payload : null;
  }

  const text = lines
    .filter((l): l is Extract<Line, { kind: "text" }> => l.kind === "text")
    .map((l) => l.text)
    .join("\n");
  if (!text.trim() || text.length > MAX_TEXT_CHARS) return null;
  return compressToEncodedURIComponent(
    JSON.stringify({ t: title, x: text, ...meta }),
  );
}

// Linkten gelen satırlar güvenilmezdir: şekil doğrulanır, görsel kaynakları
// data:image/ veya https:// ile sınırlanır, tablo HTML'i yeniden temizlenir.
function validateLine(raw: unknown): Line | null {
  if (!raw || typeof raw !== "object") return null;
  const line = raw as { kind?: unknown; text?: unknown; src?: unknown; html?: unknown };
  if (line.kind === "text" && typeof line.text === "string" && line.text.trim()) {
    return { kind: "text", text: line.text.slice(0, 5000) };
  }
  if (
    line.kind === "image" &&
    typeof line.src === "string" &&
    /^(data:image\/|https:\/\/)/.test(line.src)
  ) {
    return { kind: "image", src: line.src };
  }
  if (line.kind === "table" && typeof line.html === "string") {
    const html = sanitizeTableHtml(line.html);
    if (html) return { kind: "table", html };
  }
  return null;
}

export function decodeSharePayload(payload: string): SharedDoc | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const obj = JSON.parse(raw) as {
      t?: unknown;
      x?: unknown;
      l?: unknown;
      s?: unknown;
      n?: unknown;
    };
    const title =
      typeof obj.t === "string" && obj.t ? obj.t : "Paylaşılan metin";
    const sender = typeof obj.s === "string" && obj.s ? obj.s : undefined;
    const note = typeof obj.n === "string" && obj.n ? obj.n : undefined;

    if (Array.isArray(obj.l)) {
      const lines = obj.l
        .map(validateLine)
        .filter((l): l is Line => l !== null);
      return lines.length ? { title, lines, sender, note } : null;
    }
    if (typeof obj.x === "string" && obj.x.trim()) {
      const lines: Line[] = splitIntoLines(obj.x).map((text) => ({
        kind: "text",
        text,
      }));
      return lines.length ? { title, lines, sender, note } : null;
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
