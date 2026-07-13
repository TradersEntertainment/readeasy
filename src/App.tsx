import { useCallback, useEffect, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import { splitIntoLines } from "./lib/text";
import { applyTheme } from "./lib/themes";
import { loadDoc, loadPos, loadSettings, saveDoc, saveSettings } from "./lib/storage";

export interface Doc {
  title: string;
  lines: string[];
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [initialLine, setInitialLine] = useState(0);
  const [theme, setTheme] = useState(() => loadSettings().theme);

  useEffect(() => {
    applyTheme(theme);
    saveSettings({ theme });
  }, [theme]);

  const openText = useCallback((title: string, text: string) => {
    const lines = splitIntoLines(text);
    if (lines.length === 0) return;
    saveDoc({ title, lines });
    setInitialLine(0);
    setDoc({ title, lines });
  }, []);

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
  return <Home onOpen={openText} onResume={resume} />;
}
