// Kullanıcı tercihlerinin ve son okunan belgenin localStorage'da saklanması.

import type { AmbienceId } from "./ambience";
import type { Line } from "./doc";

export type Align = "left" | "center" | "right" | "justify";

export interface Settings {
  theme: string;
  fontScale: number;
  speedIdx: number;
  ambience: AmbienceId;
  volume: number;
  align: Align;
}

const SETTINGS_KEY = "readeasy:settings";
const DOC_KEY = "readeasy:doc";
const POS_KEY = "readeasy:pos";

// Çok büyük belgeleri (görsel data URL'leri dahil) localStorage kotasını
// doldurmamak için saklamayız; böyle belgelerde "devam et" sunulmaz.
const MAX_STORED_CHARS = 3_000_000;

const DEFAULTS: Settings = {
  theme: "gece",
  fontScale: 1,
  speedIdx: 1,
  ambience: "rain",
  volume: 0.6,
  align: "justify",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...loadSettings(), ...patch }),
    );
  } catch {
    // kota dolmuş olabilir; tercihler kritik değil
  }
}

export interface StoredDoc {
  title: string;
  lines: Line[];
}

function lineSize(line: Line): number {
  if (line.kind === "text") return line.text.length;
  return line.kind === "image" ? line.src.length : line.html.length;
}

export function saveDoc(doc: StoredDoc) {
  try {
    const size = doc.lines.reduce((sum, l) => sum + lineSize(l), 0);
    if (size > MAX_STORED_CHARS) {
      localStorage.removeItem(DOC_KEY);
      return;
    }
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
    localStorage.setItem(POS_KEY, "0");
  } catch {
    // kota dolduysa devam etmeyi engelleme
  }
}

export function loadDoc(): StoredDoc | null {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as StoredDoc;
    if (!doc.title || !Array.isArray(doc.lines) || doc.lines.length === 0) {
      return null;
    }
    // eski sürüm kayıtları: satırlar düz string dizisiydi
    if (typeof (doc.lines as unknown[])[0] === "string") {
      doc.lines = (doc.lines as unknown as string[]).map((text) => ({
        kind: "text",
        text,
      }));
    }
    return doc;
  } catch {
    return null;
  }
}

export function savePos(index: number) {
  try {
    localStorage.setItem(POS_KEY, String(index));
  } catch {
    // önemsiz
  }
}

export function loadPos(): number {
  const n = Number(localStorage.getItem(POS_KEY));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
