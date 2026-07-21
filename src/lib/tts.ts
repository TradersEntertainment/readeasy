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
  clearPreCache();
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

// Bir sonraki satırın sesi, mevcut satır çalarken önden indirilip burada
// bekletilir — böylece satırlar arası boşluk (dura dura okuma) ortadan kalkar.
// Metin, sunucuya TEK parça gider; Google'ın 200 karakter sınırını sunucu
// kendi içinde bölerek halleder.
const preCache = new Map<string, string>(); // metin -> blobURL

async function fetchClip(text: string, signal?: AbortSignal): Promise<string> {
  const hit = preCache.get(text);
  if (hit) {
    preCache.delete(text);
    return hit;
  }
  const res = await fetch(
    `${API_BASE}/api/tts?lang=tr&text=${encodeURIComponent(text)}`,
    signal ? { signal } : {},
  );
  if (!res.ok) throw new Error(`tts ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("audio")) throw new Error("not audio");
  return URL.createObjectURL(blob);
}

// Sonraki satırı arka planda getir, önbelleğe koy (ateşle-unut).
function prefetchLine(text?: string) {
  if (!text || preCache.has(text)) return;
  preCache.set(text, ""); // yer tut (çift indirmeyi önle)
  fetch(`${API_BASE}/api/tts?lang=tr&text=${encodeURIComponent(text)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error();
      const b = await r.blob();
      if (!b.type.startsWith("audio")) throw new Error();
      preCache.set(text, URL.createObjectURL(b));
    })
    .catch(() => preCache.delete(text));
}

function clearPreCache() {
  for (const url of preCache.values()) if (url) URL.revokeObjectURL(url);
  preCache.clear();
}

// Doğal sesle bir satırı okur ve BİR SONRAKİ satırı önden indirir. Klip
// alınamazsa hata fırlatır (çağıran cihaz sesine düşer). Bitince onDone.
export async function speakNatural(
  text: string,
  rate: number,
  onDone: () => void,
  nextText?: string,
): Promise<void> {
  cancel();
  const token = { cancelled: false };
  cancelledToken = token;
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

  // Satırın sesini al (önbellekte varsa oradan) — başarısızsa yukarı fırlat.
  currentUrl = await fetchClip(text, controller.signal);
  if (token.cancelled) {
    URL.revokeObjectURL(currentUrl);
    return;
  }
  audio.src = currentUrl;

  // Bir sonraki satırı hemen önden getir → satır bitince boşluk olmasın.
  prefetchLine(nextText);

  let done = false;
  const finish = () => {
    if (done || token.cancelled) return;
    done = true;
    clearTimeout(safety);
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    onDone();
  };
  audio.onended = finish;
  audio.onerror = finish;
  // Güvenlik ağı: ses çıkışı takılırsa `ended` gelmeyebilir.
  const armSafety = (ms: number) => {
    clearTimeout(safety);
    safety = window.setTimeout(finish, ms);
  };
  armSafety((text.length * 130) / audio.playbackRate + 4000);
  audio.onloadedmetadata = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      armSafety((audio.duration / audio.playbackRate) * 1000 + 900);
    }
  };
  void audio.play().catch(finish);
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
