import { useCallback, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import { splitIntoLines } from "./lib/text";

export interface Doc {
  title: string;
  lines: string[];
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);

  const openText = useCallback((title: string, text: string) => {
    const lines = splitIntoLines(text);
    if (lines.length === 0) return;
    setDoc({ title, lines });
  }, []);

  if (doc) {
    return <Reader doc={doc} onExit={() => setDoc(null)} />;
  }
  return <Home onOpen={openText} />;
}
