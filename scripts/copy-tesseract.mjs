// Tesseract'ın worker ve WASM çekirdek dosyalarını node_modules'ten
// public/ altına kopyalar; böylece OCR tamamen kendi sunucumuzdan servis
// edilir (CDN yok, çevrimdışı çalışır). build/dev öncesi otomatik koşar.

import { cpSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreSrc = path.join(root, "node_modules", "tesseract.js-core");
const outDir = path.join(root, "public", "tesseract");

mkdirSync(path.join(outDir, "core"), { recursive: true });
cpSync(
  path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  path.join(outDir, "worker.min.js"),
);
for (const file of readdirSync(coreSrc)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(file)) {
    cpSync(path.join(coreSrc, file), path.join(outDir, "core", file));
  }
}
console.log("tesseract dosyaları public/tesseract altına kopyalandı");
