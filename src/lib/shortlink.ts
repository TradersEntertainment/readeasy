// Kısa paylaşım linkleri (#s=Ab3kZ9Qw): payload bir sunucuda saklanır,
// URL yalnızca 8 karakterlik kodu taşır.
//
// İki backend sırayla denenir; hiçbiri yoksa çağıran uzun (#d=) linke düşer:
//   1. Aynı origin'deki ReadEasy sunucusu (/api/shares) — Railway'de
//      server.mjs bunu sağlar, ek yapılandırma GEREKMEZ.
//   2. Supabase (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY tanımlıysa) —
//      statik barındırma (ör. Vercel) için isteğe bağlı yol.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Statik barındırmada (ör. Vercel) başka bir ReadEasy sunucusunun API'si
// kullanılabilir: VITE_SHARE_API_URL=https://readeasy.up.railway.app
// Boşsa aynı origin denenir (Railway'de sunucu zaten oradadır).
const API_BASE = (import.meta.env.VITE_SHARE_API_URL ?? "").replace(/\/+$/, "");

const ID_PATTERN = /^[A-Za-z0-9]{6,16}$/;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function isJson(res: Response): boolean {
  return (res.headers.get("content-type") ?? "").includes("json");
}

export interface ShareMeta {
  title?: string;
  sender?: string;
  note?: string;
}

export interface CreatedShortLink {
  id: string;
  // Aynı origin'deki ReadEasy sunucusuna kaydedildiyse /s/:id biçimli
  // (OG önizlemeli) link kullanılabilir.
  sameOriginServer: boolean;
}

// ---------- 1. yol: aynı origin'deki ReadEasy sunucusu ----------

async function apiCreate(payload: string, meta: ShareMeta): Promise<string> {
  const res = await fetch(`${API_BASE}/api/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload, ...meta }),
  });
  // Statik barındırmada bu yol index.html/404 döndürür — JSON değilse yok say
  if (!res.ok || !isJson(res)) throw new Error(`api ${res.status}`);
  const { id } = (await res.json()) as { id?: string };
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error("bad id");
  }
  return id;
}

async function apiFetch(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/shares/${id}`);
    if (!res.ok || !isJson(res)) return null;
    const { payload } = (await res.json()) as { payload?: string };
    return typeof payload === "string" && payload ? payload : null;
  } catch {
    return null;
  }
}

// ---------- 2. yol: Supabase ----------

function supabaseEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON);
}

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON!,
    authorization: `Bearer ${SUPABASE_ANON}`,
    "content-type": "application/json",
  };
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

async function supabaseCreate(payload: string): Promise<string> {
  const id = randomId();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shares`, {
    method: "POST",
    headers: { ...supabaseHeaders(), prefer: "return=minimal" },
    body: JSON.stringify({ id, payload }),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return id;
}

async function supabaseFetch(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/shares?id=eq.${id}&select=payload`,
      { headers: supabaseHeaders() },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload?: string }[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

// ---------- dış arayüz ----------

export async function createShortLink(
  payload: string,
  meta: ShareMeta = {},
): Promise<CreatedShortLink> {
  try {
    const id = await apiCreate(payload, meta);
    return { id, sameOriginServer: API_BASE === "" };
  } catch {
    // aynı origin'de sunucu yok → Supabase'e bak
  }
  if (supabaseEnabled()) {
    return { id: await supabaseCreate(payload), sameOriginServer: false };
  }
  throw new Error("Kısa link servisi bulunamadı");
}

export async function fetchShortLink(id: string): Promise<string | null> {
  if (!ID_PATTERN.test(id)) return null;
  const fromApi = await apiFetch(id);
  if (fromApi) return fromApi;
  if (supabaseEnabled()) return supabaseFetch(id);
  return null;
}
