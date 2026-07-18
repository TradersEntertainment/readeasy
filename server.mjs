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
import { mkdirSync } from "node:fs";
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
  "access-control-allow-headers": "content-type",
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

  return sendJson(res, 404, { error: "not_found" });
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
