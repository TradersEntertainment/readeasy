// Okuma kayışının belge modeli: her adım bir metin cümlesi, bir görsel
// ya da bir tablo olabilir.

import { splitIntoLines } from "./text";
import type { Extracted } from "./extract";

export type Line =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "table"; html: string };

export interface Doc {
  id: string;
  title: string;
  lines: Line[];
}

export function newDocId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

export function blocksToLines(blocks: Extracted[]): Line[] {
  const lines: Line[] = [];
  for (const block of blocks) {
    if (block.kind === "text") {
      for (const text of splitIntoLines(block.text)) {
        lines.push({ kind: "text", text });
      }
    } else {
      lines.push(block);
    }
  }
  return lines;
}

// Süre tahmini ve otomatik akış için satır "ağırlığı" (karakter cinsinden).
export function lineChars(line: Line): number {
  if (line.kind === "text") return line.text.length;
  return line.kind === "image" ? 90 : 180;
}
