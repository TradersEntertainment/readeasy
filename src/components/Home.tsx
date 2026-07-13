import { useCallback, useRef, useState } from "react";
import { extractTextFromFile } from "../lib/extract";

interface Props {
  onOpen: (title: string, text: string) => void;
}

const SAMPLE_TITLE = "ReadEasy'e hoş geldin";
const SAMPLE_TEXT = `ReadEasy, uzun metinleri müzik uygulamalarındaki şarkı sözleri gibi okumanı sağlar.
Şu an tam da o deneyimin içindesin: aktif satır ekranın ortasında parlak, kocaman durur.
Az önce okudukların yukarıda hafifçe soluklaşır, birazdan okuyacakların aşağıda seni bekler.
Fare tekerleğiyle kaydırabilir, ok tuşlarına veya boşluk tuşuna basarak ilerleyebilirsin.
İstediğin satıra tıklarsan okuma o satıra atlar.
Alttaki oynat düğmesine basarsan metin, bir şarkı gibi kendi kendine akar. Hızını da ayarlayabilirsin.
A− ve A+ düğmeleriyle yazı boyutunu değiştirebilir, tam ekran düğmesiyle her şeyden uzaklaşabilirsin.
Kendi metnini denemek için Esc tuşuyla geri dön; bir PDF, Word dosyası sürükle ya da metnini yapıştır.
İyi okumalar!`;

export default function Home({ onOpen }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const extracted = await extractTextFromFile(file);
        if (!extracted.trim()) {
          throw new Error(
            "Dosyadan metin çıkarılamadı. (Taranmış/görüntü PDF'lerde metin katmanı bulunmaz.)",
          );
        }
        onOpen(file.name.replace(/\.[^.]+$/, ""), extracted);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Dosya okunamadı.");
      } finally {
        setBusy(false);
      }
    },
    [onOpen],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void openFile(file);
    },
    [openFile],
  );

  return (
    <div
      className={`home ${dragging ? "home--dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <main className="home__inner">
        <h1 className="home__logo">
          Read<span>Easy</span>
        </h1>
        <p className="home__tagline">
          Uzun metinleri, şarkı sözü okur gibi oku. Yapıştır ya da bir PDF /
          Word dosyası bırak — metin tam ekran, akıcı bir kayışa dönüşsün.
        </p>

        <textarea
          className="home__textarea"
          placeholder="Metnini buraya yapıştır…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />

        <div className="home__actions">
          <button
            className="btn btn--primary"
            disabled={busy || !text.trim()}
            onClick={() => onOpen("Yapıştırılan metin", text)}
          >
            Okumaya başla
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? "Dosya işleniyor…" : "Dosya seç (PDF · DOCX · TXT)"}
          </button>
          <button
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => onOpen(SAMPLE_TITLE, SAMPLE_TEXT)}
          >
            Örnekle dene
          </button>
        </div>

        {error && <p className="home__error">{error}</p>}

        <p className="home__hint">
          Dosyanı bu sayfanın herhangi bir yerine sürükleyip bırakabilirsin.
          Her şey tarayıcında işlenir; dosyaların hiçbir sunucuya gönderilmez.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = "";
          }}
        />
      </main>
      {dragging && <div className="home__dropOverlay">Bırak, okuyalım 📄</div>}
    </div>
  );
}
