import { useEffect, useMemo, useRef, useState } from "react";
import type { Line } from "../lib/doc";
import { saveSettings } from "../lib/storage";

interface Props {
  lines: Line[];
  startLine: number;
  initialWpm: number;
  onClose: (lineIndex: number) => void;
}

interface Word {
  text: string;
  lineIndex: number;
}

const MIN_WPM = 120;
const MAX_WPM = 700;

// ORP (optimal tanıma noktası): gözün kelimeyi en hızlı çözdüğü harf.
function orpIndex(word: string): number {
  const len = word.replace(/[^\p{L}\p{N}]/gu, "").length || word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

export default function Rsvp({ lines, startLine, initialWpm, onClose }: Props) {
  const words = useMemo<Word[]>(() => {
    const out: Word[] = [];
    lines.forEach((line, lineIndex) => {
      if (line.kind !== "text") return;
      for (const text of line.text.split(/\s+/)) {
        if (text) out.push({ text, lineIndex });
      }
    });
    return out;
  }, [lines]);

  const startIdx = useMemo(() => {
    const i = words.findIndex((w) => w.lineIndex >= startLine);
    return i === -1 ? 0 : i;
  }, [words, startLine]);

  const [idx, setIdx] = useState(startIdx);
  const [playing, setPlaying] = useState(true);
  const [wpm, setWpm] = useState(initialWpm);
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useEffect(() => saveSettings({ rsvpWpm: wpm }), [wpm]);

  // Kelime zamanlaması: uzun kelimeler ve noktalama sonrası doğal duraklar.
  useEffect(() => {
    if (!playing || words.length === 0) return;
    if (idx >= words.length - 1) {
      setPlaying(false);
      return;
    }
    const word = words[idx].text;
    let delay = 60_000 / wpm;
    if (word.length > 8) delay *= 1.3;
    if (/[.!?…]["”’')\]]*$/.test(word)) delay *= 2.2;
    else if (/[,;:]$/.test(word)) delay *= 1.5;
    const timer = setTimeout(() => setIdx((i) => i + 1), delay);
    return () => clearTimeout(timer);
  }, [playing, idx, wpm, words]);

  // Klavye: boşluk oynat/durdur, ok tuşları kelime/hız, Esc kapat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "ArrowRight":
          e.preventDefault();
          setIdx((i) => Math.min(words.length - 1, i + 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setIdx((i) => Math.max(0, i - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setWpm((w) => Math.min(MAX_WPM, w + 20));
          break;
        case "ArrowDown":
          e.preventDefault();
          setWpm((w) => Math.max(MIN_WPM, w - 20));
          break;
        case "Escape":
          e.preventDefault();
          onClose(words[idxRef.current]?.lineIndex ?? 0);
          break;
      }
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [words, onClose]);

  if (words.length === 0) {
    onClose(0);
    return null;
  }

  const word = words[Math.min(idx, words.length - 1)].text;
  const orp = Math.min(orpIndex(word), word.length - 1);
  const progress = words.length > 1 ? idx / (words.length - 1) : 1;

  return (
    <div className="rsvp">
      <div className="rsvp__progress" style={{ width: `${progress * 100}%` }} />
      <button
        className="iconBtn rsvp__close"
        onClick={() => onClose(words[idxRef.current]?.lineIndex ?? 0)}
        title="Hız modundan çık (Esc)"
      >
        ✕
      </button>

      <div className="rsvp__stage">
        <div className="rsvp__guide" />
        <div className="rsvp__word">
          <span className="rsvp__pre">{word.slice(0, orp)}</span>
          <span className="rsvp__orp">{word[orp]}</span>
          <span className="rsvp__post">{word.slice(orp + 1)}</span>
        </div>
        <div className="rsvp__guide" />
      </div>

      <div className="rsvp__controls">
        <button
          className="iconBtn"
          onClick={() => setWpm((w) => Math.max(MIN_WPM, w - 20))}
          title="Yavaşlat (↓)"
        >
          −
        </button>
        <span className="rsvp__wpm">{wpm} k/dk</span>
        <button
          className="iconBtn"
          onClick={() => setWpm((w) => Math.min(MAX_WPM, w + 20))}
          title="Hızlandır (↑)"
        >
          ＋
        </button>
        <button
          className="iconBtn iconBtn--play"
          onClick={() => setPlaying((p) => !p)}
          title="Oynat/Durdur (Boşluk)"
        >
          {playing ? "⏸" : "▶"}
        </button>
      </div>
    </div>
  );
}
