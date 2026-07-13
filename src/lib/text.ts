// Metni okuma kayışındaki adımlara böler. Kural: HER CÜMLE BİR ADIMDIR —
// kaydırma yalnızca cümle sonlarında (nokta, soru/ünlem işareti) gerçekleşir,
// cümleler asla ortadan koparılmaz. Yalnızca aşırı uzun cümleler virgül /
// noktalı virgül gibi doğal duraklardan bölünür.

// Bir cümle bundan uzunsa virgül gibi ara noktalamalardan bölmeyi dener.
const SOFT_MAX = 340;
// Hiç noktalama içermeyen aşırı uzun parçalar için son çare: kelime bölmesi.
const HARD_MAX = 560;

// Cümle sonu: . ! ? … (+ kapanış tırnak/parantezleri), ardından boşluk ve
// büyük harf / rakam / açılış tırnağı. "19. yüzyıl", "3.14" gibi kalıplarda
// bölmez çünkü noktadan sonra küçük harf ya da boşluksuz karakter gelir.
const SENTENCE_SPLIT =
  /(?<=[.!?…]["”’')\]]*)\s+(?=[A-ZÇĞİÖŞÜ0-9“"'(«[])/u;

// Yaygın kısaltmalardan sonra bölünmüşse geri birleştir (Dr. Ahmet gibi).
const ABBREVIATION =
  /\b(Dr|Prof|Doç|Yrd|Av|Sn|Sok|Cad|Apt|No|vs|vb|örn|bkz|yy|Alb|Yzb|Gen|Mah|Bkz|Age|Çev|Ed|Yay)\.$/i;

export function splitIntoLines(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{1,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const pieces = paragraph.split(SENTENCE_SPLIT);
    // kısaltma yüzünden yanlış bölünenleri birleştir
    const sentences: string[] = [];
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const prev = sentences[sentences.length - 1];
      if (prev && ABBREVIATION.test(prev)) {
        sentences[sentences.length - 1] = prev + " " + trimmed;
      } else {
        sentences.push(trimmed);
      }
    }
    for (const sentence of sentences) {
      lines.push(...splitLongSentence(sentence));
    }
  }
  return lines;
}

// Aşırı uzun bir cümleyi önce virgül/noktalı virgül gibi duraklardan,
// o da yetmezse kelime sınırlarından böler.
function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= SOFT_MAX) return [sentence];

  const clauses =
    sentence.match(/[^,;:—–]+[,;:—–]+\s*|[^,;:—–]+$/g) ?? [sentence];
  const parts: string[] = [];
  let current = "";
  for (const clause of clauses) {
    if (current && (current + clause).length > SOFT_MAX) {
      parts.push(current.trim());
      current = clause;
    } else {
      current += clause;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts.flatMap((part) =>
    part.length <= HARD_MAX ? [part] : wordWrap(part),
  );
}

function wordWrap(chunk: string): string[] {
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
