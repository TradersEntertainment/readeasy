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
let activePause: (() => void) | null = null;
let activeResume: (() => void) | null = null;

// Kilit ekranı / harici kontroller
export function pauseAudio() {
  activePause?.();
}
export function resumeAudio() {
  activeResume?.();
}

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

// ---- Media Session (kilit ekranı kontrolleri + arka plan) ----

interface MediaHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
}

function setupMediaSession(title: string, h: MediaHandlers) {
  const ms = (navigator as Navigator & { mediaSession?: MediaSession })
    .mediaSession;
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({
      title,
      artist: "ReadEasy",
      artwork: [
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    });
    ms.setActionHandler("play", h.play);
    ms.setActionHandler("pause", h.pause);
    ms.setActionHandler("nexttrack", h.next);
    ms.setActionHandler("previoustrack", h.prev);
    ms.playbackState = "playing";
  } catch {
    /* desteklenmiyorsa yok say */
  }
}

function clearMediaSession() {
  const ms = (navigator as Navigator & { mediaSession?: MediaSession })
    .mediaSession;
  if (!ms) return;
  try {
    (["play", "pause", "nexttrack", "previoustrack"] as const).forEach((a) =>
      ms.setActionHandler(a, null),
    );
    ms.playbackState = "none";
  } catch {
    /* yok say */
  }
}

function setMediaState(state: "playing" | "paused") {
  const ms = (navigator as Navigator & { mediaSession?: MediaSession })
    .mediaSession;
  if (ms) {
    try {
      ms.playbackState = state;
    } catch {
      /* yok say */
    }
  }
}

// ---- Belge kuyruğu: satırları arka arkaya, React'ten bağımsız çalar ----
// Arka planda (başka uygulamaya geçince / kilit ekranında) da devam edebilmesi
// için satır geçişi tamamen bu motorda döner; görsel (vurgu/scroll) yalnızca
// onLine ile takip eder. text[i] === null → görsel/tablo (kısa duraklama).

export interface SpeakDocOpts {
  title: string;
  onLine: (index: number) => void;
  onWord?: (line: number, start: number, end: number) => void;
  onEnd: () => void;
}

export function speakDoc(
  texts: (string | null)[],
  start: number,
  rate: number,
  opts: SpeakDocOpts,
) {
  cancel();
  const token = { cancelled: false };
  cancelledToken = token;
  const audio = getPlayer();
  audio.muted = false;
  audio.volume = 1;
  const clampRate = Math.min(2, Math.max(0.6, rate));

  let i = start;
  let paused = false;
  let currentUrl: string | null = null;
  let safety = 0;
  const clearSafety = () => clearTimeout(safety);
  const revoke = () => {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  };
  const nextText = (from: number) => {
    for (let k = from; k < texts.length; k++) if (texts[k] !== null) return k;
    return -1;
  };
  const prevText = (from: number) => {
    for (let k = from; k >= 0; k--) if (texts[k] !== null) return k;
    return -1;
  };

  activeCancel = () => {
    token.cancelled = true;
    clearSafety();
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    audio.onloadedmetadata = null;
    revoke();
    activePause = null;
    activeResume = null;
    clearMediaSession();
  };

  const finishLine = () => {
    if (token.cancelled) return;
    clearSafety();
    revoke();
    playAt(i + 1);
  };

  const playAt = (idx: number) => {
    if (token.cancelled) return;
    i = idx;
    if (idx >= texts.length) {
      opts.onEnd();
      clearMediaSession();
      return;
    }
    opts.onLine(idx);
    const text = texts[idx];
    if (text === null) {
      safety = window.setTimeout(finishLine, 1600); // görsel/tablo duraklaması
      return;
    }
    fetchClip(text)
      .then((url) => {
        if (token.cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        audio.src = url;
        audio.playbackRate = clampRate;
        const nt = nextText(idx + 1);
        if (nt !== -1) prefetchLine(texts[nt] as string);
        let advanced = false;
        const done = () => {
          if (advanced || token.cancelled) return;
          advanced = true;
          finishLine();
        };
        audio.onended = done;
        audio.onerror = done;
        const arm = (ms: number) => {
          clearSafety();
          safety = window.setTimeout(done, ms);
        };
        arm((text.length * 130) / clampRate + 4000);
        audio.onloadedmetadata = () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            arm((audio.duration / clampRate) * 1000 + 900);
          }
        };
        if (!paused) void audio.play().catch(done);
        setMediaState(paused ? "paused" : "playing");
      })
      .catch(() => {
        // doğal ses alınamadı → cihaz sesine düş (o satır için)
        if (token.cancelled) return;
        if (ttsAvailable()) {
          speakDevice(text, clampRate, finishLine, (ci) => {
            const rest = text.slice(ci);
            const sp = rest.search(/\s/);
            const end = sp === -1 ? text.length : ci + sp;
            if (end > ci) opts.onWord?.(idx, ci, end);
          });
        } else {
          finishLine();
        }
      });
  };

  activePause = () => {
    paused = true;
    clearSafety();
    audio.pause();
    setMediaState("paused");
  };
  activeResume = () => {
    if (token.cancelled) return;
    paused = false;
    void audio.play().catch(() => {});
    const remain = Number.isFinite(audio.duration)
      ? audio.duration - audio.currentTime
      : 3;
    clearSafety();
    safety = window.setTimeout(() => {
      if (!token.cancelled) finishLine();
    }, Math.max(500, (remain / clampRate) * 1000 + 900));
    setMediaState("playing");
  };

  setupMediaSession(opts.title, {
    play: () => activeResume?.(),
    pause: () => activePause?.(),
    next: () => {
      const n = nextText(i + 1);
      if (n !== -1) {
        clearSafety();
        revoke();
        playAt(n);
      }
    },
    prev: () => {
      const p = prevText(i - 1);
      if (p !== -1) {
        clearSafety();
        revoke();
        playAt(p);
      }
    },
  });

  playAt(i);
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
