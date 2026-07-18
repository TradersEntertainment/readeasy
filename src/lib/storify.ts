// "Hikayeleştir": metni bölümlere ayırır, her bölüm için AI görseli üretip
// akışa serpiştirilecek hale getirir.
//
// Ücretsiz katman: pollinations.ai (anahtar gerektirmez, CORS'a açıktır).
//   1. text.pollinations.ai — bölüm metnini kısa bir İngilizce görsel
//      istemine çevirir (başarısız olursa metnin kendisi istem olur)
//   2. image.pollinations.ai — istemden görseli üretir
// İleride premium için aynı arayüzle ücretli bir sağlayıcı (OpenAI Images,
// fal.ai vb.) backend proxy üzerinden bağlanabilir.

import type { Line } from "./doc";

const STYLE =
  ", cinematic digital illustration, atmospheric lighting, high detail, no text, no watermark";
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 14;
const EXCERPT_CHARS = 500;

export interface StorySegment {
  afterIndex: number; // görselin ekleneceği yer: bu satırın hemen ardı
  excerpt: string;
}

// Metin satırlarını 10-15 civarı (kısa metinde daha az) bitişik bölüme ayırır.
export function planSegments(lines: Line[]): StorySegment[] {
  const textIdx = lines
    .map((l, i) => (l.kind === "text" ? i : -1))
    .filter((i) => i !== -1);
  if (textIdx.length < 2) return [];
  const count = Math.min(
    Math.max(Math.round(textIdx.length / 6), MIN_SEGMENTS),
    Math.min(MAX_SEGMENTS, textIdx.length),
  );
  const per = textIdx.length / count;
  const segments: StorySegment[] = [];
  for (let k = 0; k < count; k++) {
    const slice = textIdx.slice(Math.floor(k * per), Math.floor((k + 1) * per));
    if (!slice.length) continue;
    const excerpt = slice
      .map((i) => (lines[i] as Extract<Line, { kind: "text" }>).text)
      .join(" ")
      .slice(0, EXCERPT_CHARS);
    segments.push({ afterIndex: slice[slice.length - 1], excerpt });
  }
  return segments;
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// Bölüm metnini tek cümlelik İngilizce görsel istemine çevirir.
export async function describeScene(excerpt: string): Promise<string> {
  try {
    const ask =
      "Convert this story excerpt into ONE short English image generation prompt " +
      "describing the visual scene (max 25 words). Output ONLY the prompt. Excerpt: " +
      excerpt;
    const res = await fetch(
      "https://text.pollinations.ai/" + encodeURIComponent(ask),
      { signal: withTimeout(25_000) },
    );
    if (res.ok) {
      const text = (await res.text()).trim().replace(/^["']|["']$/g, "");
      if (text && text.length < 400) return text;
    }
  } catch {
    // istem üretilemedi → metnin kendisiyle dene
  }
  return excerpt.slice(0, 200);
}

// İstemden görsel üretir, data URL döndürür (belge içinde taşınabilsin diye).
export async function generateImage(prompt: string): Promise<string> {
  const url =
    "https://image.pollinations.ai/prompt/" +
    encodeURIComponent(prompt + STYLE) +
    `?width=896&height=640&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
  const res = await fetch(url, { signal: withTimeout(90_000) });
  if (!res.ok) throw new Error(`Görsel üretilemedi (HTTP ${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Beklenmeyen yanıt");
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
