// Okuma linki paylaşımı: metin sıkıştırılıp URL hash'ine gömülür,
// linki açan kişide aynı okuma kayışı kurulur. Sunucu gerekmez.

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Line } from "./doc";

// URL'ler pratikte ~100KB'a kadar çalışsa da güvenli tarafta kalıyoruz.
const MAX_SHARE_CHARS = 60_000;

export function buildShareUrl(title: string, lines: Line[]): string | null {
  const text = lines
    .filter((l): l is Extract<Line, { kind: "text" }> => l.kind === "text")
    .map((l) => l.text)
    .join("\n");
  if (!text.trim() || text.length > MAX_SHARE_CHARS) return null;
  const payload = compressToEncodedURIComponent(
    JSON.stringify({ t: title, x: text }),
  );
  return `${location.origin}${location.pathname}#d=${payload}`;
}

export function parseShareHash(): { title: string; text: string } | null {
  const match = window.location.hash.match(/^#d=(.+)$/);
  if (!match) return null;
  try {
    const raw = decompressFromEncodedURIComponent(match[1]);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { t?: unknown; x?: unknown };
    if (typeof obj.x === "string" && obj.x.trim()) {
      return {
        title: typeof obj.t === "string" && obj.t ? obj.t : "Paylaşılan metin",
        text: obj.x,
      };
    }
  } catch {
    // bozuk hash → yok say
  }
  return null;
}
