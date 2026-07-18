// Fotoğraftan metin çıkarma (OCR): Tesseract WASM ile TAMAMEN CİHAZDA
// çalışır — fotoğraflar hiçbir sunucuya gönderilmez. Türkçe + İngilizce
// dil verileri ve WASM çekirdeği kendi sunucumuzdan gelir (çevrimdışı da
// çalışır, CDN bağımlılığı yoktur).

import { createWorker } from "tesseract.js";

const MAX_SIDE = 2200; // dev telefon fotoğraflarını hızlandırmak için küçült

export async function ocrImages(
  files: File[],
  onProgress: (message: string) => void,
): Promise<string> {
  onProgress("Metin tanıma motoru yükleniyor…");
  const worker = await createWorker(["tur", "eng"], 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tessdata",
  });
  try {
    const pages: string[] = [];
    for (let i = 0; i < files.length; i++) {
      onProgress(
        files.length > 1
          ? `Sayfa ${i + 1}/${files.length} tanınıyor…`
          : "Fotoğraftaki metin tanınıyor…",
      );
      const canvas = await prepareImage(files[i]);
      const { data } = await worker.recognize(canvas ?? files[i]);
      const text = cleanOcrText(data.text);
      if (text) pages.push(text);
    }
    return pages.join("\n\n");
  } finally {
    await worker.terminate();
  }
}

// EXIF yönünü uygular ve çok büyük fotoğrafları küçültür.
async function prepareImage(file: File): Promise<HTMLCanvasElement | null> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return null; // tarayıcı formatı desteklemiyorsa dosyayı olduğu gibi dene
  }
}

// OCR çıktısını okuma kayışına uygun hale getirir: satır sonu tirelerini
// birleştirir, satır içi kırılmaları boşluğa çevirir, paragrafları korur.
function cleanOcrText(raw: string): string {
   const PARA = String.fromCharCode(1); // paragraf sınırı için geçici işaret
  return raw
    .replace(/-\n(?=\p{Ll})/gu, "") // satır sonu tiresi: "kelime-" + "devamı"
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, PARA) // paragrafları koru
    .replace(/\n/g, " ") // satır içi kırılmalar boşluk olur
    .split(PARA)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
