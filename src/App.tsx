import { useCallback, useEffect, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import { blocksToLines, type Doc } from "./lib/doc";
import type { Extracted } from "./lib/extract";
import { applyTheme } from "./lib/themes";
import { loadDoc, loadPos, loadSettings, saveDoc, saveSettings } from "./lib/storage";
import { setPremium } from "./lib/premium";
import { decodeSharePayload, parseShareHash, parseShortHashId, type SharedDoc } from "./lib/share";
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

  useEffect(() => {
    applyTheme(theme);
    saveSettings({ theme });
  }, [theme]);

  const openBlocks = useCallback((title: string, blocks: Extracted[]) => {
    const lines = blocksToLines(blocks);
    if (lines.length === 0) return;
    saveDoc({ title, lines });
    setInitialLine(0);
    setDoc({ title, lines });
  }, []);

  // Paylaşılan okuma linkiyle gelindi mi?
  // #d=... → içerik URL'de (senkron), #s=... → içerik sunucuda (async).
  useEffect(() => {
    const openShared = (shared: SharedDoc) => {
      window.history.replaceState(null, "", window.location.pathname);
      openBlocks(shared.title, [{ kind: "text", text: shared.text }]);
      setInvite({
        sender: shared.sender,
        note: shared.note,
        title: shared.title,
      });
    };

    const shared = parseShareHash();
    if (shared) {
      openShared(shared);
      return;
    }
    const shortId = parseShortHashId();
    if (shortId) {
      void fetchShortLink(shortId).then((payload) => {
        const doc = payload && decodeSharePayload(payload);
        if (doc) openShared(doc);
        else {
          window.history.replaceState(null, "", window.location.pathname);
          console.warn("Kısa paylaşım linki çözülemedi:", shortId);
        }
      });
    }
  }, [openBlocks]);

  const resume = useCallback(() => {
    const stored = loadDoc();
    if (!stored) return;
    setInitialLine(Math.min(loadPos(), stored.lines.length - 1));
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
            </div>
          </div>
        )}
      </>
    );
  }
  return <Home onOpen={openBlocks} onResume={resume} />;
}
