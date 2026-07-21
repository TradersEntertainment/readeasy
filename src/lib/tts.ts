// Sesli okuma (TTS) — iki motor:
//
// 1) "Doğal" ses: kendi sunucumuzdaki /api/tts, Google Translate TTS'i
//    anahtarsız proxy'ler (Türkçe'de tarayıcı sesinden belirgin daha doğal).
//    Satır ≤200 karakterlik parçalara bölünüp sırayla oynatılır.
// 2) "Cihaz" sesi: tarayıcının Web Speech API'si — çevrimdışı çalışır,
//    kelime-kelime karaoke vurgusu verir. Doğal ses erişilemezse yedektir.
//
// Statik barındırmada (Vercel) API başka origin'de olabilir → VITE_SHARE_API_URL.

const API_BASE = (import.meta.env.VITE_SHARE_API_URL ?? "").replace(/\/+$/, "");

// ---- ortak durum ----

let cancelledToken = { cancelled: false };
let activeCancel: (() => void) | null = null;

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function cancel() {
  cancelledToken.cancelled = true;
  if (activeCancel) {
    activeCancel();
    activeCancel = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

// ---- doğal ses (sunucu proxy) ----

// Tek, kalıcı ses öğesi. iOS otomatik oynatmayı yalnızca kullanıcı hareketi
// içinde açar; primeAudio() bunu buton tıklamasında senkron çağırır.
let player: HTMLAudioElement | null = null;

// Geçerli, çok kısa sessiz WAV — iOS ses kilidini açmak için yüklenebilir bir
// kaynak gerekir. Modül yüklenince bir kez üretilir.
function silentWav(): string {
  const sr = 8000, n = 400; // ~0.05 sn
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  let bin = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return "data:audio/wav;base64," + btoa(bin);
}
const SILENT = silentWav();

function getPlayer(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.preload = "auto";
    // hızlı okumada tiz "sincap" sesini önle
    (player as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch =
      true;
  }
  return player;
}

// Buton tıklamasında SENKRON çağrılmalı (özellikle iOS için ses kilidini açar).
// Sessiz klip kendi kendine biter; GECİKMELİ pause YOK — yoksa hemen ardından
// çalan asıl sesi durdurabilir (sessiz kalma sebebi buydu).
export function primeAudio() {
  try {
    const p = getPlayer();
    p.muted = false;
    p.volume = 1;
    p.src = SILENT;
    const pr = p.play();
    if (pr && typeof pr.catch === "function") pr.catch(() => {});
  } catch {
    /* önemsiz */
  }
}

// Google TTS ~200 karakter sınırı: kelime sınırından böl.
function chunkText(text: string, max = 190): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, max)];
}

async function fetchClip(text: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/tts?lang=tr&text=${encodeURIComponent(text)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`tts ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("audio")) throw new Error("not audio");
  return URL.createObjectURL(blob);
}

// Doğal sesle bir satırı okur. İlk parça alınamazsa hata fırlatır (çağıran
// cihaz sesine düşer). Başladıysa satır bitince onDone çağrılır.
export async function speakNatural(
  text: string,
  rate: number,
  onDone: () => void,
): Promise<void> {
  cancel();
  const token = { cancelled: false };
  cancelledToken = token;
  const chunks = chunkText(text);
  const controller = new AbortController();
  const audio = getPlayer();
  audio.muted = false;
  audio.volume = 1;
  audio.playbackRate = Math.min(2, Math.max(0.6, rate));

  let currentUrl: string | null = null;
  let safety = 0;
  activeCancel = () => {
    token.cancelled = true;
    controller.abort();
    clearTimeout(safety);
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    audio.onloadedmetadata = null;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
  };

  // İlk parçayı önden çek — başarısızsa yukarı fırlat (yedek devreye girsin).
  let nextUrl = await fetchClip(chunks[0], controller.signal);

  let i = 0;
  const playCurrent = () => {
    if (token.cancelled) return;
    currentUrl = nextUrl;
    audio.src = currentUrl;
    const chars = chunks[i].length;
    const prefetch =
      i + 1 < chunks.length
        ? fetchClip(chunks[i + 1], controller.signal).catch(() => null)
        : Promise.resolve(null);

    let advanced = false;
    const finishChunk = () => {
      if (advanced || token.cancelled) return;
      advanced = true;
      clearTimeout(safety);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      i++;
      if (i >= chunks.length) {
        onDone();
        return;
      }
      void prefetch.then((url) => {
        if (token.cancelled) return;
        if (!url) {
          onDone(); // sonraki parça alınamadı → satırı bitmiş say
          return;
        }
        nextUrl = url;
        playCurrent();
      });
    };

    audio.onended = finishChunk;
    audio.onerror = finishChunk;
    // Güvenlik ağı: ses çıkışı yoksa/ takılırsa `ended` gelmeyebilir. Klip
    // süresi belliyse ona, değilse karakter sayısına göre yine de ilerle.
    const armSafety = (ms: number) => {
      clearTimeout(safety);
      safety = window.setTimeout(finishChunk, ms);
    };
    armSafety((chars * 130) / audio.playbackRate + 4000); // kaba üst sınır
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        armSafety((audio.duration / audio.playbackRate) * 1000 + 1200);
      }
    };
    void audio.play().catch(finishChunk);
  };
  playCurrent();
}

// ---- cihaz sesi (Web Speech) ----

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith("tr")) ??
    voices.find((v) => v.default) ??
    null
  );
}

export function speakDevice(
  text: string,
  rate: number,
  onDone: () => void,
  onWord?: (charIndex: number) => void,
) {
  cancel();
  const token = { cancelled: false };
  cancelledToken = token;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  const done = () => {
    if (!token.cancelled) onDone();
  };
  utterance.onend = done;
  utterance.onerror = done;
  if (onWord) {
    utterance.onboundary = (e) => {
      if (!token.cancelled && e.name !== "sentence") onWord(e.charIndex);
    };
  }
  window.speechSynthesis.speak(utterance);
}
