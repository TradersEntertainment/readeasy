import { useCallback, useEffect, useRef, useState } from "react";
import type { Doc } from "../App";

interface Props {
  doc: Doc;
  onExit: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const STYLE_WINDOW = 14; // aktif satırın etrafında stillenecek satır sayısı

export default function Reader({ doc, onExit }: Props) {
  const { lines } = doc;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const centersRef = useRef<number[]>([]);
  const styledRange = useRef<[number, number]>([0, -1]);
  const activeRef = useRef(0);

  const [active, setActive] = useState(0);
  const [fontScale, setFontScale] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  // Her satırın kayış içindeki dikey merkezini ölç (scroll sırasında layout
  // okuması yapmamak için önbelleğe alınır).
  const measure = useCallback(() => {
    centersRef.current = lineRefs.current.map((el) =>
      el ? el.offsetTop + el.offsetHeight / 2 : 0,
    );
  }, []);

  // Ekran ortasına en yakın satırı bul, çevresindekileri mesafeye göre
  // soluklaştır — müzik uygulamalarındaki şarkı sözü kayışının kalbi.
  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    const centers = centersRef.current;
    if (!scroller || centers.length === 0) return;
    const mid = scroller.scrollTop + scroller.clientHeight / 2;

    let lo = 0;
    let hi = centers.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (centers[m] < mid) lo = m + 1;
      else hi = m;
    }
    let nearest = lo;
    if (lo > 0 && Math.abs(centers[lo - 1] - mid) < Math.abs(centers[lo] - mid)) {
      nearest = lo - 1;
    }
    if (nearest !== activeRef.current) {
      activeRef.current = nearest;
      setActive(nearest);
    }

    const start = Math.max(0, nearest - STYLE_WINDOW);
    const end = Math.min(centers.length - 1, nearest + STYLE_WINDOW);
    const [prevStart, prevEnd] = styledRange.current;
    for (let i = prevStart; i <= prevEnd; i++) {
      if (i < start || i > end) {
        const el = lineRefs.current[i];
        if (el) {
          el.style.opacity = "";
          el.style.filter = "";
          el.classList.remove("line--active");
        }
      }
    }

    const falloff = scroller.clientHeight * 0.55;
    for (let i = start; i <= end; i++) {
      const el = lineRefs.current[i];
      if (!el) continue;
      const isActive = i === nearest;
      el.classList.toggle("line--active", isActive);
      if (isActive) {
        el.style.opacity = "1";
        el.style.filter = "none";
      } else {
        const t = Math.min(1, Math.abs(centers[i] - mid) / falloff);
        el.style.opacity = String(Math.max(0.13, 0.6 * (1 - t) ** 1.5));
        el.style.filter = `blur(${(t * 2.2).toFixed(2)}px)`;
      }
    }
    styledRange.current = [start, end];
  }, []);

  const goTo = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const scroller = scrollerRef.current;
      const centers = centersRef.current;
      if (!scroller || centers.length === 0) return;
      const i = Math.max(0, Math.min(lines.length - 1, index));
      scroller.scrollTo({
        top: centers[i] - scroller.clientHeight / 2,
        behavior,
      });
    },
    [lines.length],
  );

  // Ölçüm: ilk açılışta ve yazı boyutu / pencere boyutu değişince.
  useEffect(() => {
    measure();
    update();
    const observer = new ResizeObserver(() => {
      measure();
      update();
    });
    if (linesRef.current) observer.observe(linesRef.current);
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    return () => observer.disconnect();
  }, [measure, update, fontScale]);

  // Kaydırma dinleyicisi (kare başına en fazla bir güncelleme).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          update();
        });
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [update]);

  // Klavye kısayolları.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "j":
          e.preventDefault();
          goTo(activeRef.current + 1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "k":
          e.preventDefault();
          goTo(activeRef.current - 1);
          break;
        case "PageDown":
          e.preventDefault();
          goTo(activeRef.current + 5);
          break;
        case "PageUp":
          e.preventDefault();
          goTo(activeRef.current - 5);
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(lines.length - 1);
          break;
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "+":
        case "=":
          setFontScale((s) => Math.min(1.8, +(s + 0.1).toFixed(2)));
          break;
        case "-":
          setFontScale((s) => Math.max(0.6, +(s - 0.1).toFixed(2)));
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "Escape":
          if (!document.fullscreenElement) onExit();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, lines.length, onExit]);

  // Otomatik akış: aktif satırın uzunluğuna ve seçilen hıza göre bekleyip
  // bir sonraki satıra kayar.
  useEffect(() => {
    if (!playing) return;
    if (active >= lines.length - 1) {
      setPlaying(false);
      return;
    }
    const chars = lines[active].length;
    const ms = Math.min(14000, Math.max(1700, 800 + chars * 55)) / SPEEDS[speedIdx];
    const timer = setTimeout(() => goTo(active + 1), ms);
    return () => clearTimeout(timer);
  }, [playing, active, speedIdx, lines, goTo]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // tarayıcı izin vermezse sessizce geç
    }
  };

  const progress = lines.length > 1 ? active / (lines.length - 1) : 1;

  return (
    <div className="reader">
      <div className="reader__progress" style={{ width: `${progress * 100}%` }} />

      <header className="reader__top">
        <button className="iconBtn" onClick={onExit} title="Kapat (Esc)">
          ✕
        </button>
        <span className="reader__title">{doc.title}</span>
        <span className="reader__counter">
          {active + 1} / {lines.length}
        </span>
      </header>

      <div className="reader__scroller" ref={scrollerRef}>
        <div
          className="reader__lines"
          ref={linesRef}
          style={{ fontSize: `calc(clamp(1.5rem, 4.5vw, 3.6rem) * ${fontScale})` }}
        >
          {lines.map((line, i) => (
            <p
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className="line"
              onClick={() => goTo(i)}
            >
              {line}
            </p>
          ))}
        </div>
      </div>

      <footer className="reader__controls">
        <button
          className="iconBtn"
          onClick={() => setFontScale((s) => Math.max(0.6, +(s - 0.1).toFixed(2)))}
          title="Yazıyı küçült (-)"
        >
          A−
        </button>
        <button
          className="iconBtn"
          onClick={() => setFontScale((s) => Math.min(1.8, +(s + 0.1).toFixed(2)))}
          title="Yazıyı büyüt (+)"
        >
          A+
        </button>
        <button
          className="iconBtn iconBtn--play"
          onClick={() => setPlaying((p) => !p)}
          title="Otomatik akışı başlat/durdur (Boşluk)"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          className="iconBtn"
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          title="Akış hızı"
        >
          {SPEEDS[speedIdx]}×
        </button>
        <button
          className="iconBtn"
          onClick={() => void toggleFullscreen()}
          title="Tam ekran (F)"
        >
          {fullscreen ? "🗗" : "⛶"}
        </button>
      </footer>
    </div>
  );
}
