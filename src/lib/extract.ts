// Dosyalardan içerik çıkarır: metin + gömülü görseller + tablolar.
// Her şey tarayıcıda çalışır; dosya hiçbir sunucuya gönderilmez.
//
// - PDF: metin pdf.js getTextContent ile; gömülü görseller sayfanın
//   operatör listesinden (paintImageXObject) çekilip data URL'e çevrilir
//   ve ilgili sayfanın metninden sonra akışa eklenir.
// - DOCX: mammoth HTML'e çevirir; paragraflar metin, <img> görsel,
//   <table> ise temizlenmiş HTML tablo bloğu olur.

export type Extracted =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "table"; html: string };

const MAX_IMAGES = 40; // belge başına en fazla görsel
const MIN_IMAGE_PX = 80; // süs/ikon boyutundaki görselleri atla
const MAX_IMAGE_PX = 1400; // dev görselleri küçült (bellek + localStorage)

export async function extractFromFile(file: File): Promise<Extracted[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }
  if (name.endsWith(".doc")) {
    throw new Error(
      "Eski .doc formatı desteklenmiyor. Dosyayı Word'de .docx veya .pdf olarak kaydedip tekrar deneyin.",
    );
  }
  return [{ kind: "text", text: await file.text() }];
}

// ---------- PDF ----------

interface PdfImageObj {
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  data?: Uint8Array | Uint8ClampedArray;
}

async function extractPdf(file: File): Promise<Extracted[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const blocks: Extracted[] = [];
  let imageBudget = MAX_IMAGES;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if ("str" in item) {
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
    }
    if (pageText.trim()) blocks.push({ kind: "text", text: pageText });

    if (imageBudget > 0) {
      const images = await extractPageImages(pdfjs, page, imageBudget);
      imageBudget -= images.length;
      blocks.push(...images);
    }
  }
  return blocks;
}

async function extractPageImages(
  pdfjs: typeof import("pdfjs-dist"),
  page: import("pdfjs-dist").PDFPageProxy,
  budget: number,
): Promise<Extracted[]> {
  const out: Extracted[] = [];
  try {
    const ops = await page.getOperatorList();
    const seen = new Set<string>();
    for (let i = 0; i < ops.fnArray.length && out.length < budget; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
      const name = (ops.argsArray[i] as unknown[])[0];
      if (typeof name !== "string" || seen.has(name)) continue;
      seen.add(name);
      const obj = await resolveImageObj(page, name);
      const src = obj && imageToDataUrl(obj);
      if (src) out.push({ kind: "image", src });
    }
  } catch {
    // görseller çıkarılamazsa yalnızca metinle devam et
  }
  return out;
}

// page.objs.get bazı nesnelerde geç çözülebilir; asılı kalmamak için
// zaman aşımıyla sarıyoruz.
function resolveImageObj(
  page: import("pdfjs-dist").PDFPageProxy,
  name: string,
): Promise<PdfImageObj | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    try {
      page.objs.get(name, (value: PdfImageObj) => {
        clearTimeout(timer);
        resolve(value ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function imageToDataUrl(img: PdfImageObj): string | null {
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (w < MIN_IMAGE_PX || h < MIN_IMAGE_PX) return null;

  const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0, canvas.width, canvas.height);
  } else if (img.data) {
    const channels = img.data.length / (w * h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    if (channels === 4) {
      rgba.set(img.data);
    } else if (channels === 3) {
      for (let i = 0, j = 0; i < w * h; i++) {
        rgba[i * 4] = img.data[j++];
        rgba[i * 4 + 1] = img.data[j++];
        rgba[i * 4 + 2] = img.data[j++];
        rgba[i * 4 + 3] = 255;
      }
    } else if (channels === 1) {
      for (let i = 0; i < w * h; i++) {
        const v = img.data[i];
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
    } else {
      return null;
    }
    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    const fullCtx = full.getContext("2d");
    if (!fullCtx) return null;
    fullCtx.putImageData(new ImageData(rgba, w, h), 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  } else {
    return null;
  }

  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

// ---------- DOCX ----------

const ALLOWED_TABLE_TAGS = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TD",
  "TH",
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "SPAN",
  "COL",
  "COLGROUP",
]);

async function extractDocx(file: File): Promise<Extracted[]> {
  const mammoth = await import("mammoth/mammoth.browser");
  // convertToHtml görselleri varsayılan olarak base64 data URL olarak gömer.
  const result = await mammoth.convertToHtml({
    arrayBuffer: await file.arrayBuffer(),
  });
  const dom = new DOMParser().parseFromString(result.value, "text/html");

  const blocks: Extracted[] = [];
  let textBuffer: string[] = [];
  let imageCount = 0;
  const flushText = () => {
    if (textBuffer.length) {
      blocks.push({ kind: "text", text: textBuffer.join("\n") });
      textBuffer = [];
    }
  };
  const pushImage = (el: Element) => {
    const src = el.getAttribute("src") ?? "";
    if (src.startsWith("data:image/") && imageCount < MAX_IMAGES) {
      blocks.push({ kind: "image", src });
      imageCount++;
    }
  };

  for (const child of Array.from(dom.body.children)) {
    if (child.tagName === "TABLE") {
      flushText();
      blocks.push({ kind: "table", html: sanitizeTable(child) });
      continue;
    }
    if (child.tagName === "IMG") {
      flushText();
      pushImage(child);
      continue;
    }
    const text = (child.textContent ?? "").trim();
    if (text) textBuffer.push(text);
    const images = child.querySelectorAll("img");
    if (images.length) {
      flushText();
      images.forEach(pushImage);
    }
  }
  flushText();
  return blocks;
}

// Tablo HTML'ini beyaz listeyle temizler: izin verilmeyen etiketler
// içerikleri korunarak açılır, colspan/rowspan dışındaki tüm öznitelikler
// silinir.
function sanitizeTable(table: Element): string {
  const clone = table.cloneNode(true) as Element;
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    if (!ALLOWED_TABLE_TAGS.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== "colspan" && attr.name !== "rowspan") {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const attr of Array.from(clone.attributes)) {
    clone.removeAttribute(attr.name);
  }
  return clone.outerHTML;
}
