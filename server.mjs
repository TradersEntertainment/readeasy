// ReadEasy sunucusu (Railway için): statik siteyi (dist/) sunar ve kısa
// paylaşım linklerini diskte saklar. Sıfır bağımlılık — yalnızca Node yerleşikleri.
//
// Railway kurulumu:
//   1. Servise bir Volume ekleyin, mount path: /data
//   2. Bitti. (DATA_DIR varsayılanı /data'dır; volume yoksa ./data'ya düşer,
//      ama kalıcılık için volume şarttır — volume'suz dosyalar deploy'da silinir.)
//
// API:
//   POST /api/shares          {payload, title?, sender?, note?} → {id}
//   GET  /api/shares/:id      → {payload}
//   GET  /s/:id               → OG önizleme etiketleri gömülü uygulama sayfası
//                               (WhatsApp/iMessage linki zengin gösterir)
//   GET  /api/health          → ok

import http from "node:http";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4173);

const MAX_PAYLOAD_BYTES = 6_500_000; // ~6 MB (görselli paylaşımlar)
const ID_PATTERN = /^[A-Za-z0-9]{6,16}$/;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Veri dizini: önce DATA_DIR / /data (Railway volume), yazılamıyorsa ./data
let dataDir = process.env.DATA_DIR ?? "/data";
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  dataDir = path.join(ROOT, "data");
  mkdirSync(dataDir, { recursive: true });
}

// Basit istek sınırı: IP başına saatte 60 paylaşım oluşturma
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + 3_600_000 });
    return false;
  }
  entry.count++;
  return entry.count > 60;
}

function newId() {
  const bytes = crypto.randomBytes(8);
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

// ---- Okuma sayacı (sosyal kanıt) ----
// GERÇEK bir sayaçtır: her gerçek okuma açılışında artar. STATS_SEED ile bir
// başlangıç ivmesi verilir (varsayılan 100) — "100+" günden görünür, sonra
// gerçek kullanımla büyür. Uydurma/kendiliğinden artan değildir.
const STATS_SEED = Math.max(0, Number(process.env.STATS_SEED ?? 100) || 0);
const statsFile = path.join(dataDir, "stats.json");
let reads = STATS_SEED;
try {
  const n = JSON.parse(readFileSync(statsFile, "utf8"))?.reads;
  if (Number.isFinite(n)) reads = Math.max(STATS_SEED, n);
} catch {
  // dosya yok → seed ile başla
}

let statsDirty = false;
function bumpReads() {
  reads++;
  statsDirty = true;
}
// Diske yazımı topla (her N saniyede bir) — disk yormasın.
setInterval(() => {
  if (!statsDirty) return;
  statsDirty = false;
  fs.writeFile(statsFile, JSON.stringify({ reads }), "utf8").catch(() => {});
}, 10_000).unref();

// Okuma ping'i için IP başına kısa aralık (şişirmeyi zorlaştırır)
const readPing = new Map();
function readPingAllowed(ip) {
  const now = Date.now();
  const last = readPing.get(ip) ?? 0;
  if (now - last < 4000) return false;
  readPing.set(ip, now);
  return true;
}

// ---- TTS önbelleği + sağlayıcı ----
// Seslendirmeler diske önbelleklenir: aynı metin (aynı sesle) ikinci kez
// istenirse API'ye gitmez, volume'daki mp3'ten servis edilir → sadece disk.
const ttsCacheDir = path.join(dataDir, "ttscache");
mkdirSync(ttsCacheDir, { recursive: true });

// ElevenLabs (birinci sınıf, önerilen). Sadece anahtar gerekir; ses ve model
// varsayılanları aşağıdadır, ENV ile değiştirilebilir. Anahtar ASLA kodda değil.
//   ELEVENLABS_API_KEY    gizli anahtar (yalnızca bu tanımlıysa devreye girer)
//   ELEVENLABS_VOICE_ID   ses kimliği (varsayılan: beğenilen ses)
//   ELEVENLABS_MODEL      model (varsayılan: eleven_multilingual_v2 — Türkçe)
const EL = {
  key: (process.env.ELEVENLABS_API_KEY || "").trim(),
  voice: (process.env.ELEVENLABS_VOICE_ID || "DsbR47WNEv8o9x37ib9X").trim(),
  model: (process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2").trim(),
};

// Premium okuma şifresi (Railway'de belirlenir). Premium ses (ElevenLabs)
// yalnızca tier=premium + doğru şifre ile açılır; aksi halde Basit (Google).
const PREMIUM_PASSWORD = (
  process.env.PREMIUM_PASSWORD ||
  process.env.PREMIUM_TTS_PASSWORD ||
  ""
).trim();
// Premium seçeneği hiç sunulmalı mı? (ses + şifre tanımlıysa)
const PREMIUM_AVAILABLE = Boolean(EL.key && PREMIUM_PASSWORD);
// Anahtar ASCII dışı karakter içerirse (ör. yanlış yapıştırmadan Türkçe harf)
// fetch başlık kodlamasıyla çöker; bunu erken ve anlaşılır biçimde yakala.
function badChar(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return i;
  return -1;
}

// Genel/özel bir sağlayıcı ENV ile de tanımlanabilir (anahtar ASLA kodda değil):
//   TTS_API_URL, TTS_API_KEY, TTS_HEADER (vars. X-API-Key),
//   TTS_CONTENT_TYPE (vars. application/json),
//   TTS_BODY (gövde şablonu; {{text}} yerine metin gelir), TTS_VOICE
const TTS = {
  url: process.env.TTS_API_URL || "",
  key: process.env.TTS_API_KEY || "",
  header: process.env.TTS_HEADER || "X-API-Key",
  contentType: process.env.TTS_CONTENT_TYPE || "application/json",
  body: process.env.TTS_BODY || '{"text":"{{text}}"}',
  voice: process.env.TTS_VOICE || "",
};

function timeoutSignal(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// ElevenLabs seslendirme — audio/mpeg baytları döndürür.
async function synthElevenLabs(text) {
  const bi = badChar(EL.key);
  if (bi !== -1) {
    throw new Error(
      `ELEVENLABS_API_KEY ASCII dışı karakter içeriyor (konum ${bi}). ` +
        "Railway'de anahtarı silip ElevenLabs panelinden temiz kopyalayıp yeniden yapıştırın (sk_... ile başlar, hepsi İngilizce harf/rakam).",
    );
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${EL.voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": EL.key,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: EL.model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
      signal: timeoutSignal(20000),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`elevenlabs ${res.status}: ${detail.slice(0, 160)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function ttsCacheKey(providerTag, lang, text) {
  return crypto
    .createHash("sha1")
    .update(providerTag + "|" + lang + "|" + text)
    .digest("hex");
}

// Ücretli sağlayıcıyı çağırır; yanıt ister ham ses, ister JSON (base64/url)
// olsun ele alır. Buffer döndürür ya da hata fırlatır.
async function synthPaid(text) {
  const body = TTS.body.replace("{{text}}", () => jsonEscape(text));
  const res = await fetch(TTS.url, {
    method: "POST",
    headers: { [TTS.header]: TTS.key, "content-type": TTS.contentType },
    body,
  });
  if (!res.ok) throw new Error("paid tts " + res.status);
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("audio/")) {
    return Buffer.from(await res.arrayBuffer());
  }
  if (type.includes("json")) {
    const obj = await res.json();
    const b64 =
      obj.audioContent || obj.audio || obj.data || obj.audio_base64 || obj.base64;
    if (typeof b64 === "string" && b64.length > 100) {
      return Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64");
    }
    const url = obj.url || obj.audioUrl || obj.audio_url;
    if (typeof url === "string") {
      const a = await fetch(url);
      if (a.ok) return Buffer.from(await a.arrayBuffer());
    }
    throw new Error("paid tts: ses alanı bulunamadı");
  }
  // tip belirsizse ham baytları dene
  return Buffer.from(await res.arrayBuffer());
}

function jsonEscape(s) {
  return JSON.stringify(s).slice(1, -1);
}

// Google Translate TTS (anahtarsız yedek). ~200 karakter sınırı vardır;
// uzun metni kelime sınırından bölüp parçaları arka arkaya birleştirir.
async function synthGoogleChunk(text, lang) {
  const target =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob" +
    `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  const res = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      referer: "https://translate.google.com/",
    },
    signal: timeoutSignal(20000),
  });
  if (!res.ok) throw new Error("google tts " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function splitForGoogle(text, max = 190) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [text.slice(0, max)];
}

async function synthGoogle(text, lang) {
  const parts = splitForGoogle(text);
  if (parts.length === 1) return synthGoogleChunk(parts[0], lang);
  const bufs = [];
  for (const p of parts) bufs.push(await synthGoogleChunk(p, lang));
  return Buffer.concat(bufs); // MP3 çerçeveleri arka arkaya sorunsuz çalar
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

const API_HEADERS = {
  "content-type": "application/json",
  // Native uygulama (Capacitor) farklı origin'den çağırır
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-tts-pass",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function sendJson(res, status, body) {
  res.writeHead(status, API_HEADERS);
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, API_HEADERS);
    return res.end();
  }

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/shares" && req.method === "POST") {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "?";
    if (rateLimited(ip)) {
      return sendJson(res, 429, { error: "rate_limited" });
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_PAYLOAD_BYTES) {
        return sendJson(res, 413, { error: "too_large" });
      }
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return sendJson(res, 400, { error: "bad_json" });
    }
    const { payload } = body;
    if (typeof payload !== "string" || !payload.trim()) {
      return sendJson(res, 400, { error: "bad_payload" });
    }
    const record = {
      payload,
      title: typeof body.title === "string" ? body.title.slice(0, 120) : "",
      sender: typeof body.sender === "string" ? body.sender.slice(0, 60) : "",
      note: typeof body.note === "string" ? body.note.slice(0, 280) : "",
    };
    const id = newId();
    await fs.writeFile(path.join(dataDir, id), JSON.stringify(record), "utf8");
    return sendJson(res, 201, { id });
  }

  const shareMatch = url.pathname.match(/^\/api\/shares\/([A-Za-z0-9]{6,16})$/);
  if (shareMatch && req.method === "GET") {
    const record = await readShare(shareMatch[1]);
    if (!record) return sendJson(res, 404, { error: "not_found" });
    return sendJson(res, 200, { payload: record.payload });
  }

  // Doğal sesli okuma: Google Translate TTS'i proxy'ler (anahtarsız). Tarayıcı
  // CORS ve UA kısıtları nedeniyle doğrudan çağıramaz; sunucu araya girer.
  if (url.pathname === "/api/tts" && req.method === "GET") {
    return handleTts(req, res, url);
  }

  // Premium okuma: seçenek sunulmalı mı? (GET) / şifre doğru mu? (POST)
  if (url.pathname === "/api/premium-check") {
    if (req.method === "GET") {
      return sendJson(res, 200, { available: PREMIUM_AVAILABLE });
    }
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let pass = "";
      try {
        pass = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).pass ?? "");
      } catch {
        return sendJson(res, 400, { error: "bad_json" });
      }
      const ok = PREMIUM_AVAILABLE && pass === PREMIUM_PASSWORD;
      return sendJson(res, 200, { ok, available: PREMIUM_AVAILABLE });
    }
  }

  // Okuma sayacı (sosyal kanıt).
  if (url.pathname === "/api/stats" && req.method === "GET") {
    return sendJson(res, 200, { reads });
  }
  if (url.pathname === "/api/read" && req.method === "POST") {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "?";
    if (readPingAllowed(ip)) bumpReads();
    return sendJson(res, 200, { reads });
  }

  return sendJson(res, 404, { error: "not_found" });
}

const TTS_LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

function asciiHeader(s) {
  return String(s).replace(/[^\x20-\x7E]/g, "?").slice(0, 180);
}

function sendAudio(res, buf, cached, provider, err) {
  const headers = {
    "content-type": "audio/mpeg",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=604800",
    "x-tts-cache": cached ? "hit" : "miss",
    "x-tts-provider": provider || "cache",
  };
  if (err) headers["x-tts-error"] = asciiHeader(err);
  res.writeHead(200, headers);
  res.end(buf);
}

async function handleTts(req, res, url) {
  const text = (url.searchParams.get("text") ?? "").slice(0, 600);
  const lang = url.searchParams.get("lang") ?? "tr";
  if (!text.trim() || !TTS_LANG.test(lang)) {
    return sendJson(res, 400, { error: "bad_request" });
  }

  // Premium mi? tier=premium + doğru şifre (başlık ya da sorgu) gerekir.
  const tier = url.searchParams.get("tier") ?? "simple";
  const pass = (
    req.headers["x-tts-pass"] ??
    url.searchParams.get("pass") ??
    ""
  ).toString();
  const wantPremium =
    tier === "premium" && PREMIUM_AVAILABLE && pass === PREMIUM_PASSWORD;
  const providerTag = wantPremium ? "el:" + EL.voice + ":" + EL.model : "google";

  // 1) Önbellek: aynı metin (aynı katman) daha önce seslendirildiyse diskten.
  const cacheFile = path.join(
    ttsCacheDir,
    ttsCacheKey(providerTag, lang, text) + ".mp3",
  );
  try {
    const cached = await fs.readFile(cacheFile);
    return sendAudio(res, cached, true, wantPremium ? "elevenlabs" : "google");
  } catch {
    // önbellekte yok → üret
  }

  // 2) Üret: premium → ElevenLabs (olmazsa Google'a düş); değilse Google.
  let buf = null;
  let provider = "google";
  let lastErr = "";
  if (wantPremium) {
    try {
      buf = await synthElevenLabs(text);
      provider = "elevenlabs";
    } catch (e) {
      lastErr = e.message;
      console.warn("ElevenLabs başarısız, Google'a düşülüyor:", e.message);
    }
  }
  if (!buf) {
    try {
      buf = await synthGoogle(text, lang);
      provider = "google";
    } catch {
      return sendJson(res, 502, { error: "tts_failed", detail: asciiHeader(lastErr) });
    }
  }
  if (!buf || buf.length < 200) {
    return sendJson(res, 502, { error: "tts_empty" });
  }

  // 3) Önbelleğe yaz (sonraki isteklerde API harcaması olmasın) ve servis et.
  fs.writeFile(cacheFile, buf).catch(() => {});
  sendAudio(res, buf, false, provider, provider !== "elevenlabs" ? lastErr : "");
}

// Kayıt hem yeni (JSON) hem eski (düz payload metni) biçimde okunabilir.
async function readShare(id) {
  if (!ID_PATTERN.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(dataDir, id), "utf8");
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.payload === "string") return obj;
    } catch {
      // eski biçim: dosyanın tamamı payload
    }
    return { payload: raw, title: "", sender: "", note: "" };
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// /s/:id — uygulamayı, linkin içeriğine özel Open Graph etiketleriyle sunar.
// WhatsApp, iMessage, Twitter vb. bu etiketlerden zengin önizleme üretir.
async function serveSharePage(res, id) {
  const record = await readShare(id);
  let html = await fs.readFile(path.join(DIST, "index.html"), "utf8");
  if (record) {
    const title = record.title || "Sana bir okuma gönderildi";
    const description = record.sender
      ? `💌 ${record.sender} sana bir okuma gönderdi${record.note ? ` — “${record.note}”` : ""}`
      : `💌 Sana bir okuma gönderildi${record.note ? ` — “${record.note}”` : ""}. Şarkı sözü gibi akıcı oku.`;
    const meta = [
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:type" content="article" />`,
      `<meta property="og:site_name" content="ReadEasy" />`,
      `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    ].join("\n    ");
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)} — ReadEasy</title>`)
      .replace("</head>", `    ${meta}\n  </head>`);
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(html);
}

async function serveStatic(res, urlPath) {
  // path traversal engeli + SPA fallback
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(DIST, safe);
  if (!filePath.startsWith(DIST)) filePath = path.join(DIST, "index.html");
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    await fs.access(filePath);
  } catch {
    filePath = path.join(DIST, "index.html");
  }
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const sharePage = url.pathname.match(/^\/s\/([A-Za-z0-9]{6,16})$/);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
      } else if (sharePage && req.method === "GET") {
        await serveSharePage(res, sharePage[1]);
      } else {
        await serveStatic(res, url.pathname);
      }
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
      }
      res.end("server error");
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`ReadEasy sunucusu ${PORT} portunda — veri dizini: ${dataDir}`);
  });
