// Tablo HTML'i için beyaz liste temizleyici. Hem dosyadan çıkarılan hem de
// paylaşım linkinden gelen (güvenilmeyen!) tablolar buradan geçer.

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

// İçeriğiyle birlikte tamamen silinecek etiketler (metinleri bile kalmasın).
const DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "SVG",
  "MATH",
  "FORM",
  "INPUT",
  "BUTTON",
  "TEXTAREA",
  "SELECT",
  "TEMPLATE",
]);

// Tehlikeli etiketler içerikleriyle silinir; izin verilmeyen diğer etiketler
// içerikleri korunarak açılır; colspan/rowspan dışındaki tüm öznitelikler
// silinir.
export function sanitizeTableElement(table: Element): string {
  const clone = table.cloneNode(true) as Element;
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    if (DROP_TAGS.has(el.tagName)) {
      el.remove();
      continue;
    }
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

// Serbest bir HTML dizesinden yalnızca temizlenmiş <table> döndürür.
export function sanitizeTableHtml(html: string): string | null {
  try {
    const dom = new DOMParser().parseFromString(html, "text/html");
    const table = dom.body.querySelector("table");
    if (!table) return null;
    const clean = sanitizeTableElement(table);
    return clean.includes("<table") ? clean : null;
  } catch {
    return null;
  }
}
