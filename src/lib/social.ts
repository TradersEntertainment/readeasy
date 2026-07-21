// Okuma sayacı (sosyal kanıt). Sunucudaki gerçek sayacı okur/artırır.
// Statik barındırmada API başka origin'de olabilir → VITE_SHARE_API_URL.

const API_BASE = (import.meta.env.VITE_SHARE_API_URL ?? "").replace(/\/+$/, "");

// Her belge açılışında en fazla bir kez say (aynı oturumda tekrar açmalar
// sayacı şişirmesin).
const pinged = new Set<string>();

export function pingRead(docId: string) {
  if (pinged.has(docId)) return;
  pinged.add(docId);
  // ateşle-unut; başarısızlık okumayı etkilemez
  void fetch(`${API_BASE}/api/read`, { method: "POST" }).catch(() => {});
}

export async function fetchReads(): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    if (!res.ok) return null;
    const data = (await res.json()) as { reads?: unknown };
    return typeof data.reads === "number" ? data.reads : null;
  } catch {
    return null;
  }
}

// "1.234", "12,3B", "1,2Mn" gibi kısa/okunur biçim.
export function formatReads(n: number): string {
  if (n < 1000) return n.toLocaleString("tr-TR");
  if (n < 1_000_000) {
    const k = n / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(".", ",")) + "B";
  }
  const m = n / 1_000_000;
  return (m >= 10 ? Math.round(m) : m.toFixed(1).replace(".", ",")) + "Mn";
}
