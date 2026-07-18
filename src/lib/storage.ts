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
  bionic: boolean;
  rsvpWpm: number;
  shareName: string;
}

const SETTINGS_KEY = "readeasy:settings";
const LIBRARY_KEY = "readeasy:library";
const DOC_PREFIX = "readeasy:doc:";
// eski tek-belge anahtarları (kitaplığa taşınır)
const LEGACY_DOC_KEY = "readeasy:doc";
const LEGACY_POS_KEY = "readeasy:pos";

// Tek belge sınırı ve tüm kitaplık için toplam bütçe (localStorage ~5MB).
// Bütçe aşılırsa en uzun süredir okunmayan belgeler silinir.
const MAX_DOC_CHARS = 3_000_000;
const LIBRARY_BUDGET_CHARS = 4_200_000;

const DEFAULTS: Settings = {
  theme: "gece",
  fontScale: 1,
  speedIdx: 1,
  ambience: "rain",
  volume: 0.6,
  align: "justify",
  bionic: false,
  rsvpWpm: 320,
  shareName: "",
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
  id: string;
  title: string;
  lines: Line[];
}

export interface LibraryEntry {
  id: string;
  title: string;
  savedAt: number;
  lastReadAt: number;
  pos: number;
  total: number;
  chars: number;
}

function lineSize(line: Line): number {
  if (line.kind === "text") return line.text.length;
  return line.kind === "image" ? line.src.length : line.html.length;
}

function readLibraryRaw(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const entries = raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function writeLibrary(entries: LibraryEntry[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    // önemsiz
  }
}

// Eski tek-belge kaydını (varsa) kitaplığa taşı.
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_DOC_KEY);
    if (!raw) return;
    const doc = JSON.parse(raw) as { title?: string; lines?: unknown[] };
    localStorage.removeItem(LEGACY_DOC_KEY);
    const pos = Number(localStorage.getItem(LEGACY_POS_KEY)) || 0;
    localStorage.removeItem(LEGACY_POS_KEY);
    if (!doc.title || !Array.isArray(doc.lines) || doc.lines.length === 0) {
      return;
    }
    let lines = doc.lines as Line[];
    if (typeof (doc.lines as unknown[])[0] === "string") {
      lines = (doc.lines as unknown as string[]).map((text) => ({
        kind: "text",
        text,
      }));
    }
    const id = "legacy" + Date.now();
    saveDocToLibrary({ id, title: doc.title, lines });
    updateProgress(id, pos, lines.length);
  } catch {
    // eski kayıt bozuksa yok say
  }
}

export function listLibrary(): LibraryEntry[] {
  migrateLegacy();
  return readLibraryRaw().sort((a, b) => b.lastReadAt - a.lastReadAt);
}

// Bütçeyi aşarsak en uzun süredir okunmayan belgeleri sil (keepId hariç).
function evict(entries: LibraryEntry[], keepId: string): LibraryEntry[] {
  const sorted = entries.slice().sort((a, b) => a.lastReadAt - b.lastReadAt);
  let total = sorted.reduce((sum, e) => sum + e.chars, 0);
  const result = new Set(sorted.map((e) => e.id));
  for (const entry of sorted) {
    if (total <= LIBRARY_BUDGET_CHARS) break;
    if (entry.id === keepId) continue;
    localStorage.removeItem(DOC_PREFIX + entry.id);
    result.delete(entry.id);
    total -= entry.chars;
  }
  return entries.filter((e) => result.has(e.id));
}

export function saveDocToLibrary(doc: StoredDoc) {
  const chars = doc.lines.reduce((sum, l) => sum + lineSize(l), 0);
  if (chars > MAX_DOC_CHARS) return; // bu belge yalnızca oturumluk
  const content = JSON.stringify({ title: doc.title, lines: doc.lines });
  const store = () => localStorage.setItem(DOC_PREFIX + doc.id, content);
  let entries = readLibraryRaw();
  const now = Date.now();
  const existing = entries.find((e) => e.id === doc.id);
  const entry: LibraryEntry = {
    id: doc.id,
    title: doc.title,
    savedAt: existing?.savedAt ?? now,
    lastReadAt: now,
    pos: existing?.pos ?? 0,
    total: doc.lines.length,
    chars,
  };
  entries = entries.filter((e) => e.id !== doc.id).concat(entry);
  entries = evict(entries, doc.id);
  try {
    store();
  } catch {
    // kota doldu → diğer her şeyi boşaltıp bir kez daha dene
    for (const e of entries) {
      if (e.id !== doc.id) localStorage.removeItem(DOC_PREFIX + e.id);
    }
    entries = entries.filter((e) => e.id === doc.id);
    try {
      store();
    } catch {
      writeLibrary(entries.filter((e) => e.id !== doc.id));
      return;
    }
  }
  writeLibrary(entries);
}

export function loadDocFromLibrary(id: string): StoredDoc | null {
  try {
    const raw = localStorage.getItem(DOC_PREFIX + id);
    if (!raw) return null;
    const doc = JSON.parse(raw) as { title?: string; lines?: Line[] };
    if (!doc.title || !Array.isArray(doc.lines) || doc.lines.length === 0) {
      return null;
    }
    return { id, title: doc.title, lines: doc.lines };
  } catch {
    return null;
  }
}

export function updateProgress(id: string, pos: number, total: number) {
  const entries = readLibraryRaw();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.pos = pos;
  entry.total = total;
  entry.lastReadAt = Date.now();
  writeLibrary(entries);
}

export function removeFromLibrary(id: string) {
  localStorage.removeItem(DOC_PREFIX + id);
  writeLibrary(readLibraryRaw().filter((e) => e.id !== id));
}
