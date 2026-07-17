// Okuma linki paylaşımı: metin (+ gönderen adı ve notu) sıkıştırılıp URL
// hash'ine gömülür; linki açan kişide aynı okuma kayışı ve bir karşılama
// kartı kurulur. Sunucu gerekmez.

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Line } from "./doc";

// URL'ler pratikte ~100KB'a kadar çalışsa da güvenli tarafta kalıyoruz.
const MAX_SHARE_CHARS = 60_000;

export interface SharedDoc {
  title: string;
  text: string;
  sender?: string;
  note?: string;
}

export function buildShareUrl(
  title: string,
  lines: Line[],
  opts: { sender?: string; note?: string } = {},
): string | null {
  const text = lines
    .filter((l): l is Extract<Line, { kind: "text" }> => l.kind === "text")
    .map((l) => l.text)
    .join("\n");
  if (!text.trim() || text.length > MAX_SHARE_CHARS) return null;
  const payload = compressToEncodedURIComponent(
    JSON.stringify({
      t: title,
      x: text,
      ...(opts.sender ? { s: opts.sender.slice(0, 60) } : {}),
      ...(opts.note ? { n: opts.note.slice(0, 280) } : {}),
    }),
  );
  return `${location.origin}${location.pathname}#d=${payload}`;
}

export function parseShareHash(): SharedDoc | null {
  const match = window.location.hash.match(/^#d=(.+)$/);
  if (!match) return null;
  try {
    const raw = decompressFromEncodedURIComponent(match[1]);
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
    // bozuk hash → yok say
  }
  return null;
}
