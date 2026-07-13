import { useCallback, useEffect, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import { blocksToLines, type Doc } from "./lib/doc";
import type { Extracted } from "./lib/extract";
import { applyTheme } from "./lib/themes";
import { loadDoc, loadPos, loadSettings, saveDoc, saveSettings } from "./lib/storage";
import { setPremium } from "./lib/premium";
import { parseShareHash } from "./lib/share";

// Ödeme sağlayıcısının başarı yönlendirmesi (ör. Stripe success_url →
// https://site/?premium=1). GEÇİCİ: gerçek ödeme entegrasyonunda bu hak
// sunucu tarafında doğrulanmalı; şimdilik yalnızca test amaçlıdır.
if (new URLSearchParams(window.location.search).get("premium") === "1") {
  setPremium(true);
  window.history.replaceState(null, "", window.location.pathname);
}

export type { Doc };

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [initialLine, setInitialLine] = useState(0);
  const [theme, setTheme] = useState(() => loadSettings().theme);

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

  // Paylaşılan okuma linkiyle gelindi mi? (#d=... hash'i)
  useEffect(() => {
    const shared = parseShareHash();
    if (shared) {
      window.history.replaceState(null, "", window.location.pathname);
      openBlocks(shared.title, [{ kind: "text", text: shared.text }]);
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
      <Reader
        doc={doc}
        initialLine={initialLine}
        theme={theme}
        onThemeChange={setTheme}
        onExit={() => setDoc(null)}
      />
    );
  }
  return <Home onOpen={openBlocks} onResume={resume} />;
}
