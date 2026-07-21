import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractFromFile, type Extracted } from "../lib/extract";
import { ocrImages } from "../lib/ocr";
import { listLibrary, removeFromLibrary } from "../lib/storage";
import { fetchFromUrl } from "../lib/url";
import { loadStats } from "../lib/stats";
import { fetchReads, formatReads } from "../lib/social";

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
  const [reads, setReads] = useState<number | null>(null);
  useEffect(() => {
    void fetchReads().then(setReads);
  }, []);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Bekleyen (sahnelenmiş) görseller: Gemini gibi küçük önizleme kartlarında
  // birikir, kullanıcı ekleyip çıkarabilir, sonra hepsi birden okunur.
  const [pending, setPending] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );

  const addImages = useCallback((files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    setError(null);
    setPending((prev) => [
      ...prev,
      ...imgs.map((file) => ({
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : String(Math.random()),
        file,
        url: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  // Belge (PDF/DOCX/TXT) — anında işlenir.
  const openDocument = useCallback(
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
            "Dosyadan içerik çıkarılamadı. (Taranmış/görüntü PDF'lerde metin katmanı bulunmaz — sayfanın fotoğrafını çekip 📷 ile deneyin.)",
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

  // Bekleyen görselleri cihazda OCR'la ve oku.
  const readPending = useCallback(async () => {
    const items = pendingRef.current;
    if (items.length === 0 || busy) return;
    const images = items.map((p) => p.file);
    setBusy(true);
    setError(null);
    try {
      const text = await ocrImages(images, setBusyMsg);
      if (!text.trim()) {
        throw new Error(
          "Görsellerde okunabilir metin bulunamadı. Daha net, iyi aydınlatılmış kareler deneyin.",
        );
      }
      const single = images[0].name.replace(/\.[^.]+$/, "").trim();
      const title =
        images.length > 1
          ? `Taranan metin (${images.length} sayfa)`
          : !single ||
              /^(image|screenshot|görüntü|photo|resim|ekran)/i.test(single)
            ? "Ekran görüntüsü"
            : single;
      items.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
      onOpen(title, [{ kind: "text", text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Görseller okunamadı.");
    } finally {
      setBusy(false);
      setBusyMsg(null);
    }
  }, [busy, onOpen]);

  // Dosya girişini yönlendir: görseller kartlara sahnelenir, belgeler
  // anında açılır.
  const intake = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length > 0) addImages(images);
      else void openDocument(files[0]);
    },
    [addImages, openDocument],
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
      intake(Array.from(e.dataTransfer.files ?? []));
    },
    [intake],
  );

  // Ctrl/Cmd+V ile görsel yapıştır → önizleme kartlarına eklenir. Sayfanın
  // herhangi bir yerinde çalışır. Pano'da resim yoksa (düz metin) karışmaz.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const images: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) images.push(file);
        }
      }
      if (images.length > 0) {
        e.preventDefault();
        addImages(images);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages]);

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

        {reads !== null && reads > 0 && (
          <div className="home__social" title="Bugüne kadarki toplam okuma">
            <span className="home__socialDot" />
            <b>{formatReads(reads)}+</b> okuma yapıldı
          </div>
        )}

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

        {pending.length > 0 && (
          <div className="staging">
            <div className="staging__thumbs">
              {pending.map((p) => (
                <div key={p.id} className="thumb">
                  <img src={p.url} alt="" />
                  <button
                    className="thumb__remove"
                    title="Kaldır"
                    onClick={() => removePending(p.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="thumb thumb--add"
                title="Görsel ekle"
                disabled={busy}
                onClick={() => cameraInputRef.current?.click()}
              >
                ＋
              </button>
            </div>
            <button
              className="btn btn--primary staging__read"
              disabled={busy}
              onClick={() => void readPending()}
            >
              {busy
                ? (busyMsg ?? "Okunuyor…")
                : `📖 Oku · ${pending.length} görsel`}
            </button>
            <p className="panel__hint">
              Daha fazla ekran görüntüsü yapıştırabilir ya da ＋ ile
              ekleyebilirsin; hepsi tek belge olarak okunur.
            </p>
          </div>
        )}

        <div className="home__urlRow">
          <input
            className="home__url"
            type="url"
            placeholder="🔗 Link yapıştır — makale, blog, X gönderisi, AI sohbeti…"
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
          placeholder="Metnini buraya yapıştır… (ekran görüntüsünü de Ctrl/⌘+V ile yapıştırabilirsin)"
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
            {busy ? (busyMsg ?? "Dosya işleniyor…") : "Dosya seç (PDF · DOCX · TXT)"}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => cameraInputRef.current?.click()}
            title="Fotoğraf çek veya seç — metin cihazında tanınır"
          >
            📷 Fotoğraftan oku
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
          Dosya ya da fotoğrafları bu sayfaya sürükleyip bırakabilir, hatta bir
          ekran görüntüsünü <kbd>Ctrl/⌘</kbd>+<kbd>V</kbd> ile doğrudan
          yapıştırabilirsin; birden çok görsel tek belge olarak birleşir.
          Her şey cihazında işlenir, hiçbir sunucuya gönderilmez.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,image/*,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            intake(files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          multiple
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            intake(files);
            e.target.value = "";
          }}
        />
      </main>
      {dragging && <div className="home__dropOverlay">Bırak, okuyalım 📄</div>}
    </div>
  );
}
