// Kısa paylaşım linkleri: metnin kendisi URL yerine Supabase'de saklanır,
// linke yalnızca 8 karakterlik bir kod gömülür (#s=Ab3kZ9Qw).
//
// Kurulum (README'de ayrıntısı var): ücretsiz bir Supabase projesi açıp
// "shares" tablosunu oluşturun ve dağıtım ortamına şu değişkenleri ekleyin:
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// Değişkenler tanımlı değilse uygulama otomatik olarak uzun (#d=) linke düşer.

const BASE = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ID_LENGTH = 8;
const ID_PATTERN = /^[A-Za-z0-9]{6,16}$/;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function shortLinksEnabled(): boolean {
  return Boolean(BASE && ANON);
}

function headers(): Record<string, string> {
  return {
    apikey: ANON!,
    authorization: `Bearer ${ANON}`,
    "content-type": "application/json",
  };
}

function randomId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

// Sıkıştırılmış payload'ı kaydeder, kısa kodu döndürür.
export async function createShortLink(payload: string): Promise<string> {
  const id = randomId();
  const res = await fetch(`${BASE}/rest/v1/shares`, {
    method: "POST",
    headers: { ...headers(), prefer: "return=minimal" },
    body: JSON.stringify({ id, payload }),
  });
  if (!res.ok) {
    throw new Error(`Kısa link oluşturulamadı (HTTP ${res.status})`);
  }
  return id;
}

export async function fetchShortLink(id: string): Promise<string | null> {
  if (!shortLinksEnabled() || !ID_PATTERN.test(id)) return null;
  try {
    const res = await fetch(
      `${BASE}/rest/v1/shares?id=eq.${id}&select=payload`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload?: string }[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}
