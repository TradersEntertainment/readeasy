// Metni, şarkı sözü kayışındaki gibi ekranda tek seferde rahat okunacak
// parçalara böler. Paragraflar korunur; uzun paragraflar cümle sınırlarından,
// aşırı uzun cümleler ise kelime sınırlarından bölünür.

const TARGET = 150; // hedef parça uzunluğu (karakter)
const HARD_MAX = 230; // bu uzunluğu aşan tek cümleler kelimeden bölünür

export function splitIntoLines(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{1,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= TARGET) {
      lines.push(paragraph);
      continue;
    }
    const sentences =
      paragraph.match(/[^.!?…]+[.!?…]+["”’')\]]*\s*|[^.!?…]+$/g) ?? [paragraph];
    let current = "";
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      if (current && (current + " " + sentence).length > TARGET) {
        lines.push(...hardWrap(current));
        current = sentence;
      } else {
        current = current ? current + " " + sentence : sentence;
      }
    }
    if (current) lines.push(...hardWrap(current));
  }
  return lines;
}

function hardWrap(chunk: string): string[] {
  if (chunk.length <= HARD_MAX) return [chunk];
  const words = chunk.split(" ");
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > HARD_MAX) {
      parts.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}
