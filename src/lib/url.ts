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

const TWEET_PATTERN = /(?:twitter|x)\.com\/[^/]+\/status\/\d+/i;

export async function fetchFromUrl(
  input: string,
): Promise<{ title: string; blocks: Extracted[] }> {
  const url = normalizeUrl(input);
  const isTweet = TWEET_PATTERN.test(url);

  // 1) Doğrudan dene (CORS'a izin veren siteler; X'te işe yaramaz, atla)
  if (!isTweet) {
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
  }

  // 2) r.jina.ai okuyucu proxy'si
  try {
    const res = await fetch("https://r.jina.ai/" + url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseJinaMarkdown(await res.text(), url);
    // X sayfaları bazen yalnızca giriş duvarı döndürür; içerik yeterliyse kullan
    if (contentLength(parsed.blocks) >= (isTweet ? 200 : 40)) return parsed;
    if (!isTweet) {
      throw new Error(
        "Sayfadan okunabilir içerik çıkarılamadı. Link herkese açık bir sayfaya mı gidiyor?",
      );
    }
  } catch (e) {
    if (!isTweet) {
      throw e instanceof Error && !/^HTTP \d+$/.test(e.message)
        ? e
        : new Error(
            "Sayfa içeriği alınamadı. Linkin herkese açık olduğundan emin olun — " +
              "AI sohbetlerinde normal sohbet linki değil, 'Paylaş' ile oluşturulan link gerekir.",
          );
    }
  }

  // 3) X gönderisi: resmi oEmbed ile en azından gönderinin kendisini al
  const tweet = await fetchTweetViaOEmbed(url);
  if (tweet) return tweet;
  throw new Error(
    "X/Twitter bu içeriğe girişsiz erişime izin vermedi. Thread'in metnini " +
      "kopyalayıp yapıştırabilir ya da ekran görüntülerini '📷 Fotoğraftan oku' " +
      "ile tarayabilirsin — sayfalar tek belgede birleşir.",
  );
}

// X'in resmi oEmbed servisi tek gönderinin metnini girişsiz verir
// (thread'in tamamını vermez). CORS kapalı olduğu için Jina üzerinden geçer.
async function fetchTweetViaOEmbed(
  url: string,
): Promise<{ title: string; blocks: Extracted[] } | null> {
  try {
    const target =
      "https://publish.twitter.com/oembed?omit_script=true&url=" +
      encodeURIComponent(url);
    const res = await fetch("https://r.jina.ai/" + target);
    if (!res.ok) return null;
    const raw = await res.text();
    const start = raw.indexOf('{"');
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      html?: string;
      author_name?: string;
    };
    if (typeof obj.html !== "string") return null;
    const dom = new DOMParser().parseFromString(obj.html, "text/html");
    const text = dom.querySelector("blockquote p")?.textContent?.trim();
    if (!text) return null;
    const author =
      typeof obj.author_name === "string" && obj.author_name
        ? obj.author_name
        : "X";
    return {
      title: `${author} — X gönderisi`,
      blocks: [
        { kind: "text", text },
        {
          kind: "text",
          text:
            "Not: X, thread'in devamına girişsiz erişime izin vermiyor; bu yalnızca ilk gönderi. " +
            "Thread'in tamamı için metni kopyalayıp yapıştır ya da ekran görüntülerini 📷 ile tara.",
        },
      ],
    };
  } catch {
    return null;
  }
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

const MD_IMAGE = /!\[[^\]]*\]\((https:\/\/[^)\s]+?)(?:\s+"[^"]*")?\)/g;
const MAX_URL_IMAGES = 30;

function markdownToBlocks(md: string): Extracted[] {
  const blocks: Extracted[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let textBuffer: string[] = [];
  let tableBuffer: string[] = [];
  let imageCount = 0;

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

    // Satırdaki görselleri akışa kart olarak al (yalnızca https; svg/ikon değil)
    const images: string[] = [];
    if (imageCount < MAX_URL_IMAGES) {
      for (const match of trimmed.matchAll(MD_IMAGE)) {
        const src = match[1];
        if (!/\.svg(\?|$)/i.test(src) && imageCount + images.length < MAX_URL_IMAGES) {
          images.push(src);
        }
      }
    }
    const cleaned = cleanInlineMd(trimmed);
    if (cleaned) textBuffer.push(cleaned);
    if (images.length) {
      flushText();
      for (const src of images) {
        blocks.push({ kind: "image", src });
        imageCount++;
      }
    }
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
