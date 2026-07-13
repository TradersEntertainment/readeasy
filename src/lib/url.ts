// Link'ten içerik çekme: makaleler ve AI sohbet paylaşım linkleri
// (ChatGPT, Claude, Gemini...).
//
// Strateji: önce doğrudan fetch denenir (CORS'a açık siteler için);
// engellenirse r.jina.ai okuyucu proxy'si kullanılır — herhangi bir sayfayı
// temiz markdown olarak, CORS'a açık şekilde döndürür.

import type { Extracted } from "./extract";

const AI_CHAT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "g.co",
  "grok.com",
  "chat.deepseek.com",
  "copilot.microsoft.com",
  "perplexity.ai",
];

export async function fetchFromUrl(
  input: string,
): Promise<{ title: string; blocks: Extracted[] }> {
  const url = normalizeUrl(input);

  // 1) Doğrudan dene (CORS'a izin veren siteler)
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok) {
      const type = res.headers.get("content-type") ?? "";
      const body = await res.text();
      if (type.includes("text/plain") && body.trim()) {
        return { title: fallbackTitle(url), blocks: [{ kind: "text", text: body }] };
      }
      if (type.includes("html")) {
        const parsed = parseHtmlDocument(body, url);
        if (parsed && contentLength(parsed.blocks) > 400) return parsed;
      }
    }
  } catch {
    // CORS/ağ hatası → proxy'ye düş
  }

  // 2) r.jina.ai okuyucu proxy'si
  const res = await fetch("https://r.jina.ai/" + url);
  if (!res.ok) {
    throw new Error(
      `Sayfa içeriği alınamadı (HTTP ${res.status}). Linkin herkese açık olduğundan emin olun — ` +
        "AI sohbetlerinde normal sohbet linki değil, 'Paylaş' ile oluşturulan link gerekir.",
    );
  }
  const parsed = parseJinaMarkdown(await res.text(), url);
  if (contentLength(parsed.blocks) < 40) {
    throw new Error(
      "Sayfadan okunabilir içerik çıkarılamadı. Link herkese açık bir sayfaya mı gidiyor?",
    );
  }
  return parsed;
}

function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("Bir link yapıştırın.");
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Bu bir link gibi görünmüyor.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Yalnızca http(s) linkleri desteklenir.");
  }
  return url.toString();
}

function isAiChat(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return AI_CHAT_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function fallbackTitle(url: string): string {
  if (isAiChat(url)) return "AI Sohbeti";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

function contentLength(blocks: Extracted[]): number {
  return blocks.reduce(
    (sum, b) => sum + (b.kind === "text" ? b.text.length : 50),
    0,
  );
}

// ---------- HTML ayrıştırma (doğrudan fetch yolu) ----------

function parseHtmlDocument(
  html: string,
  url: string,
): { title: string; blocks: Extracted[] } | null {
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom
    .querySelectorAll("script,style,noscript,nav,footer,header,aside,form")
    .forEach((el) => el.remove());
  const root =
    dom.querySelector("article") ?? dom.querySelector("main") ?? dom.body;
  if (!root) return null;

  const paragraphs: string[] = [];
  root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre").forEach((el) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  });
  const text = paragraphs.length
    ? paragraphs.join("\n")
    : (root.textContent ?? "").trim();
  if (!text) return null;
  return {
    title: dom.title.trim() || fallbackTitle(url),
    blocks: [{ kind: "text", text }],
  };
}

// ---------- Jina markdown ayrıştırma ----------

function parseJinaMarkdown(
  raw: string,
  url: string,
): { title: string; blocks: Extracted[] } {
  let title = "";
  let content = raw;

  const titleMatch = raw.match(/^Title:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  const marker = raw.indexOf("Markdown Content:");
  if (marker !== -1) {
    content = raw.slice(marker + "Markdown Content:".length);
  }

  return {
    title: title || fallbackTitle(url),
    blocks: markdownToBlocks(content),
  };
}

function markdownToBlocks(md: string): Extracted[] {
  const blocks: Extracted[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let textBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushText = () => {
    const text = textBuffer.join("\n").trim();
    if (text) blocks.push({ kind: "text", text });
    textBuffer = [];
  };
  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      const html = mdTableToHtml(tableBuffer);
      if (html) blocks.push({ kind: "table", html });
    } else if (tableBuffer.length) {
      textBuffer.push(...tableBuffer.map(cleanInlineMd));
    }
    tableBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      tableBuffer.push(trimmed);
      continue;
    }
    if (tableBuffer.length) flushTable();

    if (!trimmed) {
      textBuffer.push("");
      continue;
    }
    if (/^(-{3,}|={3,}|\*{3,})$/.test(trimmed)) continue; // yatay çizgi
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) continue; // salt görsel satırı
    textBuffer.push(cleanInlineMd(trimmed));
  }
  flushTable();
  flushText();
  return blocks;
}

function cleanInlineMd(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "") // başlıklar
    .replace(/^>\s?/, "") // alıntı
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // gömülü görseller
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // linkler → metin
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .trim();
}

// Markdown tablosunu güvenli HTML'e çevirir (hücreler textContent ile
// yazıldığı için HTML enjeksiyonu mümkün değildir).
function mdTableToHtml(rows: string[]): string | null {
  const parsed = rows
    .filter((r) => !/^\|?[\s:|-]+\|?$/.test(r)) // ayraç satırı (|---|---|)
    .map((r) =>
      r
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => cleanInlineMd(c)),
    )
    .filter((cells) => cells.some((c) => c));
  if (parsed.length < 2) return null;

  const table = document.createElement("table");
  parsed.forEach((cells, rowIndex) => {
    const tr = document.createElement("tr");
    for (const cell of cells) {
      const td = document.createElement(rowIndex === 0 ? "th" : "td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  return table.outerHTML;
}
