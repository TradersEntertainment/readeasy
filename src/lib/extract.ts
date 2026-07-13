// Dosyalardan (PDF, DOCX, TXT/MD) düz metin çıkarır. Her şey tarayıcıda
// çalışır; dosya hiçbir sunucuya gönderilmez.

export async function extractTextFromFile(file: File): Promise<string> {
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
  // .txt, .md ve diğer düz metin dosyaları
  return file.text();
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  const pages: string[] = [];
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
    pages.push(pageText);
  }
  return pages.join("\n\n");
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });
  return result.value;
}
