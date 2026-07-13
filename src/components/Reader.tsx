import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Doc } from "../App";
import { AMBIENCES, ambience, type AmbienceId } from "../lib/ambience";
import { THEMES } from "../lib/themes";
import { loadSettings, savePos, saveSettings, type Align } from "../lib/storage";
import { addReadingSeconds, grantAdReward, isPremium, remainingSeconds } from "../lib/premium";
import { tick, thump } from "../lib/haptics";
import Paywall from "./Paywall";

interface Props {
  doc: Doc;
  initialLine: number;
  theme: string;
  onThemeChange: (id: string) => void;
  onExit: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const ALIGNMENTS: { id: Align; name: string }[] = [
  { id: "left", name: "Sola" },
  { id: "center", name: "Ortala" },
  { id: "right", name: "Sağa" },
  { id: "justify", name: "İki yana" },
];
const STYLE_WINDOW = 14; // aktif satırın etrafında stillenecek satır sayısı
const READING_CPS = 16; // kalan süre tahmini için ortalama karakter/saniye

type Panel = "none" | "sound" | "theme";

export default function Reader({ doc, initialLine, theme, onThemeChange, onExit }: Props) {
  const { lines } = doc;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const centersRef = useRef<number[]>([]);
  const styledRange = useRef<[number, number]>([0, -1]);
  const activeRef = useRef(initialLine);
  const initedRef = useRef(false);

  const settings = useRef(loadSettings()).current;
  const [active, setActive] = useState(initialLine);
  const [fontScale, setFontScale] = useState(settings.fontScale);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(settings.speedIdx);
  const [fullscreen, setFullscreen] = useState(false);
  const [panel, setPanel] = useState<Panel>("none");
  const panelRef = useRef<Panel>("none");
  panelRef.current = panel;
  const [sound, setSound] = useState<AmbienceId | null>(null);
  const [volume, setVolume] = useState(settings.volume);
  const [align, setAlign] = useState<Align>(settings.align);
  const premium = useRef(isPremium()).current;
  const [remaining, setRemaining] = useState(() => remainingSeconds());
  const [paywall, setPaywall] = useState(() => !premium && remainingSeconds() <= 0);
  const paywallRef = useRef(paywall);
  paywallRef.current = paywall;

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
    if (!initedRef.current) {
      initedRef.current = true;
      if (initialLine > 0) goTo(initialLine, "auto");
    }
    update();
    const observer = new ResizeObserver(() => {
      measure();
      update();
    });
    if (linesRef.current) observer.observe(linesRef.current);
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    return () => observer.disconnect();
  }, [measure, update, goTo, initialLine, fontScale]);

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
      if (paywallRef.current) return; // kota ekranı açıkken gezinme kilitli
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
          if (panelRef.current !== "none") setPanel("none");
          else if (!document.fullscreenElement) onExit();
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

  // Tercihleri ve okuma konumunu kalıcılaştır.
  useEffect(() => saveSettings({ fontScale }), [fontScale]);
  useEffect(() => saveSettings({ speedIdx }), [speedIdx]);
  useEffect(() => saveSettings({ align }), [align]);
  useEffect(() => savePos(active), [active]);

  // Satır geçişinde çok hafif dokunsal geri bildirim.
  useEffect(() => {
    if (active !== initialLine) tick();
  }, [active, initialLine]);

  // Okurken ekran uyanık kalsın (Wake Lock API — iOS native tarafında ayrıca
  // AppDelegate'te isIdleTimerDisabled ayarlanır).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      navigator.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    };
    acquire();
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Ücretsiz kullanım sayacı: sekme görünürken her 5 saniyede bir işle.
  useEffect(() => {
    if (premium) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || paywallRef.current) return;
      addReadingSeconds(5);
      const left = remainingSeconds();
      setRemaining(left);
      if (left <= 0) {
        setPaywall(true);
        setPlaying(false);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [premium]);

  // Ses: seviye değişimini motora aktar; okuyucudan çıkınca sesi kapat.
  useEffect(() => {
    ambience.setVolume(volume);
    saveSettings({ volume });
  }, [volume]);
  useEffect(() => () => ambience.stop(), []);

  const toggleSound = (id: AmbienceId) => {
    if (sound === id) {
      ambience.stop();
      setSound(null);
    } else {
      ambience.setVolume(volume);
      ambience.play(id);
      setSound(id);
      saveSettings({ ambience: id });
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // tarayıcı izin vermezse sessizce geç
    }
  };

  // Kalan okuma süresi tahmini
  const cumulativeChars = useMemo(() => {
    const sums = [0];
    for (const line of lines) sums.push(sums[sums.length - 1] + line.length);
    return sums;
  }, [lines]);
  const remainingMin = Math.ceil(
    (cumulativeChars[lines.length] - cumulativeChars[active]) /
      (READING_CPS * SPEEDS[speedIdx] * 60),
  );

  const progress = lines.length > 1 ? active / (lines.length - 1) : 1;
  const soundMeta = AMBIENCES.find((a) => a.id === sound);

  return (
    <div className="reader">
      <div className="reader__progress" style={{ width: `${progress * 100}%` }} />

      <header className="reader__top">
        <button className="iconBtn" onClick={onExit} title="Kapat (Esc)">
          ✕
        </button>
        <span className="reader__title">{doc.title}</span>
        <span className="reader__counter">
          {!premium &&
            Number.isFinite(remaining) &&
            `Ücretsiz: ${Math.max(0, Math.ceil(remaining / 60))} dk · `}
          {remainingMin > 0 && `≈${remainingMin} dk · `}
          {active + 1} / {lines.length}
        </span>
      </header>

      <div
        className="reader__scroller"
        ref={scrollerRef}
        onClick={() => panel !== "none" && setPanel("none")}
      >
        <div
          className="reader__lines"
          ref={linesRef}
          data-align={align}
          style={{
            fontSize: `calc(clamp(1.5rem, 4.5vw, 3.6rem) * ${fontScale})`,
            textAlign: align,
          }}
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

      {panel === "sound" && (
        <div className="panel">
          <span className="panel__title">Ortam sesi</span>
          <div className="chips">
            {AMBIENCES.map((a) => (
              <button
                key={a.id}
                className={`chip ${sound === a.id ? "chip--on" : ""}`}
                onClick={() => toggleSound(a.id)}
              >
                {a.emoji} {a.name}
              </button>
            ))}
          </div>
          <label className="volume">
            <span className="panel__title">Ses seviyesi</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {panel === "theme" && (
        <div className="panel">
          <span className="panel__title">Tema</span>
          <div className="swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`swatch ${theme === t.id ? "swatch--on" : ""}`}
                style={{
                  background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})`,
                }}
                title={t.name}
                onClick={() => onThemeChange(t.id)}
              />
            ))}
          </div>
          <span className="panel__title">Hizalama</span>
          <div className="chips">
            {ALIGNMENTS.map((a) => (
              <button
                key={a.id}
                className={`chip ${align === a.id ? "chip--on" : ""}`}
                onClick={() => setAlign(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {paywall && (
        <Paywall
          onReward={() => {
            grantAdReward();
            setRemaining(remainingSeconds());
            setPaywall(false);
          }}
          onExit={onExit}
        />
      )}

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
          className={`iconBtn ${sound ? "iconBtn--live" : ""}`}
          onClick={() => setPanel((p) => (p === "sound" ? "none" : "sound"))}
          title="Ortam sesi"
        >
          {soundMeta ? soundMeta.emoji : "🎧"}
        </button>
        <button
          className="iconBtn iconBtn--play"
          onClick={() => {
            thump();
            setPlaying((p) => !p);
          }}
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
          onClick={() => setPanel((p) => (p === "theme" ? "none" : "theme"))}
          title="Tema"
        >
          🎨
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
