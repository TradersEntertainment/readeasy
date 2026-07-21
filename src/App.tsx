import { useCallback, useEffect, useRef, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import { blocksToLines, newDocId, type Doc, type Line } from "./lib/doc";
import type { Extracted } from "./lib/extract";
import { applyTheme } from "./lib/themes";
import {
  listLibrary,
  loadDocFromLibrary,
  loadSettings,
  saveDocToLibrary,
  saveSettings,
} from "./lib/storage";
import { setPremium } from "./lib/premium";
import {
  decodeSharePayload,
  parsePathShareId,
  parseShareHash,
  parseShortHashId,
  type SharedDoc,
} from "./lib/share";
import { fetchShortLink } from "./lib/shortlink";

// Ödeme sağlayıcısının başarı yönlendirmesi (ör. Stripe success_url →
// https://site/?premium=1). GEÇİCİ: gerçek ödeme entegrasyonunda bu hak
// sunucu tarafında doğrulanmalı; şimdilik yalnızca test amaçlıdır.
if (new URLSearchParams(window.location.search).get("premium") === "1") {
  setPremium(true);
  window.history.replaceState(null, "", window.location.pathname);
}

export type { Doc };

interface Invite {
  sender?: string;
  note?: string;
  title: string;
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [initialLine, setInitialLine] = useState(0);
  const [theme, setTheme] = useState(() => loadSettings().theme);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  // Bu tarayıcıda uygulama daha önce hiç açıldı mı? (yalnızca gerçek ilk
  // ziyarette tanıtım şeridini göstermek için) — openShared'dan önce çalışsın.
  const firstVisit = useRef(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("readeasy:visited")) {
        firstVisit.current = true;
        localStorage.setItem("readeasy:visited", "1");
      }
    } catch {
      // localStorage yoksa tanıtımı göstermeyiz
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    saveSettings({ theme });
  }, [theme]);

  const openLines = useCallback((title: string, lines: Line[]) => {
    if (lines.length === 0) return;
    const newDoc: Doc = { id: newDocId(), title, lines };
    saveDocToLibrary(newDoc);
    setInitialLine(0);
    setDoc(newDoc);
  }, []);

  const openBlocks = useCallback(
    (title: string, blocks: Extracted[]) => {
      openLines(title, blocksToLines(blocks));
    },
    [openLines],
  );

  // Paylaşılan okuma linkiyle gelindi mi?
  // #d=... → içerik URL'de (senkron), #s=... → içerik sunucuda (async).
  useEffect(() => {
    const openShared = (shared: SharedDoc) => {
      window.history.replaceState(null, "", "/");
      openLines(shared.title, shared.lines);
      setInvite({
        sender: shared.sender,
        note: shared.note,
        title: shared.title,
      });
      if (firstVisit.current) setShowIntro(true);
    };

    const shared = parseShareHash();
    if (shared) {
      openShared(shared);
      return;
    }
    const shortId = parseShortHashId() ?? parsePathShareId();
    if (shortId) {
      void fetchShortLink(shortId).then((payload) => {
        const doc = payload && decodeSharePayload(payload);
        if (doc) openShared(doc);
        else {
          window.history.replaceState(null, "", "/");
          console.warn("Kısa paylaşım linki çözülemedi:", shortId);
        }
      });
    }
  }, [openLines]);

  const resume = useCallback((id: string) => {
    const stored = loadDocFromLibrary(id);
    if (!stored) return;
    const entry = listLibrary().find((e) => e.id === id);
    setInitialLine(Math.min(entry?.pos ?? 0, stored.lines.length - 1));
    setDoc(stored);
  }, []);

  if (doc) {
    return (
      <>
        <Reader
          doc={doc}
          initialLine={initialLine}
          theme={theme}
          onThemeChange={setTheme}
          onExit={() => {
            setInvite(null);
            setShowIntro(false);
            setDoc(null);
          }}
        />
        {invite && (
          <div className="invite">
            <div className="invite__card">
              <span className="invite__emoji">💌</span>
              <h2>
                {invite.sender
                  ? `${invite.sender} sana bir okuma gönderdi`
                  : "Sana bir okuma gönderildi"}
              </h2>
              {invite.note && <p className="invite__note">“{invite.note}”</p>}
              <p className="invite__title">{invite.title}</p>
              <button
                className="btn btn--primary"
                onClick={() => setInvite(null)}
              >
                Okumaya başla ▶
              </button>
              <p className="invite__brand">
                <b>ReadEasy</b> · uzun yazıları şarkı sözü gibi akıcı okuma
              </p>
            </div>
          </div>
        )}
        {showIntro && !invite && (
          <div className="intro">
            <span className="intro__text">
              ✨ Bu deneyim <b>ReadEasy</b> — kendi yazılarını, PDF'lerini,
              hatta ekran görüntülerini de böyle akıcı okuyabilirsin.
            </span>
            <button
              className="intro__cta"
              onClick={() => {
                setShowIntro(false);
                setDoc(null);
              }}
            >
              Dene
            </button>
            <button
              className="intro__close"
              title="Kapat"
              onClick={() => setShowIntro(false)}
            >
              ✕
            </button>
          </div>
        )}
      </>
    );
  }
  return <Home onOpen={openBlocks} onResume={resume} />;
}
