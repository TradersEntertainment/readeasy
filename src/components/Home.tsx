import { useCallback, useMemo, useRef, useState } from "react";
import { extractFromFile, type Extracted } from "../lib/extract";
import { loadDoc, loadPos } from "../lib/storage";
import { fetchFromUrl } from "../lib/url";
import { loadStats } from "../lib/stats";

interface Props {
  onOpen: (title: string, blocks: Extracted[]) => void;
  onResume: () => void;
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

export default function Home({ onOpen, onResume }: Props) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const stats = useMemo(loadStats, []);
  const stored = useMemo(() => {
    const doc = loadDoc();
    if (!doc) return null;
    const pos = Math.min(loadPos(), doc.lines.length - 1);
    if (pos < 1) return null; // henüz okumaya başlanmamış
    return {
      title: doc.title,
      percent: Math.round((pos / (doc.lines.length - 1)) * 100),
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const blocks = await extractFromFile(file);
        const hasContent = blocks.some(
          (b) => b.kind !== "text" || b.text.trim(),
        );
        if (!hasContent) {
          throw new Error(
            "Dosyadan içerik çıkarılamadı. (Taranmış/görüntü PDF'lerde metin katmanı bulunmaz.)",
          );
        }
        onOpen(file.name.replace(/\.[^.]+$/, ""), blocks);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Dosya okunamadı.");
      } finally {
        setBusy(false);
      }
    },
    [onOpen],
  );

  const openUrl = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchFromUrl(url);
      onOpen(result.title, result.blocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link içeriği alınamadı.");
    } finally {
      setBusy(false);
    }
  }, [url, onOpen]);

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

        {stats.totalSeconds >= 60 && (
          <p className="home__stats">
            🔥 {stats.streak} gün seri · ⏱{" "}
            {Math.round(stats.totalSeconds / 60).toLocaleString("tr-TR")} dk
            okuma · 📚 {stats.words.toLocaleString("tr-TR")} kelime
          </p>
        )}

        {stored && (
          <button className="btn btn--resume" onClick={onResume}>
            ⏯ Kaldığın yerden devam et — {stored.title} (%{stored.percent})
          </button>
        )}

        <div className="home__urlRow">
          <input
            className="home__url"
            type="url"
            placeholder="🔗 Link yapıştır — makale, ChatGPT/Claude sohbet paylaşımı…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void openUrl();
            }}
            spellCheck={false}
          />
          <button
            className="btn btn--primary"
            disabled={busy || !url.trim()}
            onClick={() => void openUrl()}
          >
            {busy ? "…" : "Getir"}
          </button>
        </div>

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
            onClick={() => onOpen("Yapıştırılan metin", [{ kind: "text", text }])}
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
            onClick={() => onOpen(SAMPLE_TITLE, [{ kind: "text", text: SAMPLE_TEXT }])}
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
