import { useCallback, useMemo, useRef, useState } from "react";
import { extractFromFile, type Extracted } from "../lib/extract";
import { listLibrary, removeFromLibrary } from "../lib/storage";
import { fetchFromUrl } from "../lib/url";
import { loadStats } from "../lib/stats";

interface Props {
  onOpen: (title: string, blocks: Extracted[]) => void;
  onResume: (id: string) => void;
}

// Başlıktan deterministik bir kapak degrade'si üret.
function coverGradient(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  return `linear-gradient(135deg, hsl(${hash} 65% 52%), hsl(${(hash + 50) % 360} 70% 40%))`;
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
  const [library, setLibrary] = useState(() => listLibrary());
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

        {library.length > 0 && (
          <div className="library">
            <span className="library__heading">📚 Kitaplığın</span>
            {library.map((entry) => {
              const percent =
                entry.total > 1
                  ? Math.round((entry.pos / (entry.total - 1)) * 100)
                  : 100;
              return (
                <div
                  key={entry.id}
                  className="libCard"
                  onClick={() => onResume(entry.id)}
                >
                  <div
                    className="libCard__cover"
                    style={{ background: coverGradient(entry.title) }}
                  />
                  <div className="libCard__info">
                    <span className="libCard__name">{entry.title}</span>
                    <div className="libCard__meta">
                      <div className="libCard__bar">
                        <div
                          className="libCard__fill"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span>%{percent}</span>
                    </div>
                  </div>
                  <button
                    className="libCard__delete"
                    title="Kitaplıktan kaldır"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromLibrary(entry.id);
                      setLibrary(listLibrary());
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
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
