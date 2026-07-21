import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lineChars, type Doc } from "../lib/doc";
import { cancel as ttsCancel, checkPremiumPass, premiumAvailable, primeAudio, setTtsTier, speakDoc } from "../lib/tts";
import { AMBIENCES, ambience, type AmbienceId } from "../lib/ambience";
import { THEMES } from "../lib/themes";
import { loadNotes, loadSettings, saveNotes, saveSettings, updateProgress, type Align, type Notes } from "../lib/storage";
import { addReadingSeconds, grantAdReward, isPremium, remainingSeconds } from "../lib/premium";
import { tick, thump } from "../lib/haptics";
import { trackSeconds, trackWords } from "../lib/stats";
import { encodeSharePayload, longShareUrl, pathShareUrl, shortShareUrl } from "../lib/share";
import { createShortLink } from "../lib/shortlink";
import { describeScene, generateImage, planSegments } from "../lib/storify";
import { chatAboutDoc, type ChatMessage } from "../lib/chat";
import { saveDocToLibrary } from "../lib/storage";
import Paywall from "./Paywall";
import Rsvp from "./Rsvp";

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

type Panel = "none" | "sound" | "theme" | "share" | "chat" | "voice";

// Bionic okuma: her kelimenin ilk ~%40'ı kalın — göz kelimeyi yarım
// görüp beynin tamamlamasına izin verir, odaklanmayı kolaylaştırır.
function bionicWords(text: string) {
  return text.split(" ").map((word, i) => {
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length || word.length;
    const n = Math.max(1, Math.ceil(letters * 0.4));
    return (
      <span key={i}>
        {i > 0 ? " " : ""}
        <b>{word.slice(0, n)}</b>
        {word.slice(n)}
      </span>
    );
  });
}

export default function Reader({ doc, initialLine, theme, onThemeChange, onExit }: Props) {
  // Satırlar yerel state'tir: "Hikayeleştir" üretilen görselleri akışa
  // canlı olarak ekler.
  const [lines, setLines] = useState(doc.lines);
  useEffect(() => setLines(doc.lines), [doc]);
  const linesLiveRef = useRef(lines);
  linesLiveRef.current = lines;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLElement | null)[]>([]);
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
  const [tts, setTts] = useState(false);
  const ttsRef = useRef(false);
  ttsRef.current = tts;
  const [ttsMode, setTtsMode] = useState<"simple" | "premium">("simple");
  const [premiumAvail, setPremiumAvail] = useState(false);
  const [premiumPass, setPremiumPass] = useState<string>(
    () => localStorage.getItem("readeasy:ttspass") ?? "",
  );
  const [passInput, setPassInput] = useState("");
  const [passErr, setPassErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void premiumAvailable().then(setPremiumAvail);
  }, []);
  const [bionic, setBionic] = useState(settings.bionic);
  // Karaoke: TTS'in o an söylediği kelimenin konumu (satır + karakter aralığı)
  const [ttsWord, setTtsWord] = useState<{ line: number; start: number; end: number } | null>(null);
  const [rsvp, setRsvp] = useState(false);
  const rsvpRef = useRef(false);
  rsvpRef.current = rsvp;
  const [toast, setToast] = useState<string | null>(null);
  const [shareName, setShareName] = useState(settings.shareName);
  const [shareNote, setShareNote] = useState("");
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
      // Bir giriş alanına yazılıyorsa (paylaşım notu vb.) kısayolları
      // çalıştırma — yalnızca Escape paneli/baloncuğu kapatabilir.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        if (e.key === "Escape") {
          if (bubbleRef.current) setBubble(null);
          else if (panelRef.current !== "none") setPanel("none");
          target.blur();
        }
        return;
      }
      if (paywallRef.current) return; // kota ekranı açıkken gezinme kilitli
      if (rsvpRef.current) return; // hız modu kendi kısayollarını yönetir
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
          if (ttsRef.current) setTts(false);
          else setPlaying((p) => !p);
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
          if (bubbleRef.current) setBubble(null);
          else if (panelRef.current !== "none") setPanel("none");
          else if (!document.fullscreenElement) onExit();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, lines.length, onExit]);

  // Otomatik akış: aktif satırın uzunluğuna ve seçilen hıza göre bekleyip
  // bir sonraki satıra kayar. (TTS açıkken akışı TTS sürer.)
  useEffect(() => {
    if (!playing || tts) return;
    if (active >= lines.length - 1) {
      setPlaying(false);
      return;
    }
    const chars = lineChars(lines[active]);
    const ms = Math.min(14000, Math.max(1700, 800 + chars * 55)) / SPEEDS[speedIdx];
    const timer = setTimeout(() => goTo(active + 1), ms);
    return () => clearTimeout(timer);
  }, [playing, tts, active, speedIdx, lines, goTo]);

  // Sesli okuma: kuyruk motoru satırları arka arkaya çalar (React'ten
  // bağımsız → başka uygulamaya geçince / kilit ekranında arka planda devam
  // eder). Görsel yalnızca onLine ile takip eder. Efekt aktif satıra bağlı
  // DEĞİL; yoksa her satırda yeniden başlardı.
  useEffect(() => {
    if (!tts) {
      ttsCancel();
      setTtsWord(null);
      return;
    }
    setTtsTier(ttsMode, ttsMode === "premium" ? premiumPass : "");
    const texts = lines.map((l) => (l.kind === "text" ? l.text : null));
    speakDoc(texts, activeRef.current, SPEEDS[speedIdx], {
      title: doc.title,
      onLine: (idx) => {
        setTtsWord(null);
        goTo(idx);
      },
      onWord: (line, start, end) => setTtsWord({ line, start, end }),
      onEnd: () => setTts(false),
    });
    return () => {
      ttsCancel();
      setTtsWord(null);
    };
  }, [tts, speedIdx, lines, doc.title, goTo, ttsMode, premiumPass]);

  // Seçilen katmanla sesli okumayı başlat.
  const startTts = (mode: "simple" | "premium", pass = "") => {
    thump();
    primeAudio(); // iOS ses kilidini kullanıcı hareketi içinde aç
    setPlaying(false);
    setTtsMode(mode);
    setPanel("none");
    setTts(true);
    void pass; // pass, premiumPass state'ine kaydedildikten sonra kullanılır
  };

  const startPremium = async () => {
    if (premiumPass) {
      startTts("premium");
      return;
    }
    const p = passInput.trim();
    if (!p) return;
    setChecking(true);
    setPassErr(null);
    const ok = await checkPremiumPass(p);
    setChecking(false);
    if (ok) {
      try {
        localStorage.setItem("readeasy:ttspass", p);
      } catch {
        /* önemsiz */
      }
      setPremiumPass(p);
      setPassInput("");
      startTts("premium", p);
    } else {
      setPassErr("Şifre yanlış. Railway'de belirlediğin premium şifresini gir.");
    }
  };

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Tercihleri ve okuma konumunu kalıcılaştır.
  useEffect(() => saveSettings({ fontScale }), [fontScale]);
  useEffect(() => saveSettings({ speedIdx }), [speedIdx]);
  useEffect(() => saveSettings({ align }), [align]);
  useEffect(() => saveSettings({ bionic }), [bionic]);
  useEffect(
    () => updateProgress(doc.id, active, lines.length),
    [doc.id, active, lines.length],
  );

  // İstatistik: ileri gidilen satırların kelimeleri.
  const prevActiveRef = useRef(initialLine);
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = active;
    if (active > prev) {
      let words = 0;
      for (let i = prev; i < active; i++) {
        const line = lines[i];
        if (line.kind === "text") words += line.text.split(/\s+/).length;
      }
      trackWords(words);
    }
  }, [active, lines]);

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

  // Süre sayacı: sekme görünürken her 5 saniyede bir işle — istatistik
  // herkes için, kota yalnızca ücretsiz kullanıcılar için.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || paywallRef.current) return;
      trackSeconds(5);
      if (premium) return;
      addReadingSeconds(5);
      const left = remainingSeconds();
      setRemaining(left);
      if (left <= 0) {
        setPaywall(true);
        setPlaying(false);
        setTts(false);
        setRsvp(false);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [premium]);

  useEffect(() => saveSettings({ shareName }), [shareName]);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [storify, setStorify] = useState<{ done: number; total: number } | null>(null);
  const storifyCancelled = useRef(false);

  // 💬 Belge hakkında AI sohbeti (oturumluk; belgeyle birlikte saklanmaz)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatBusy, panel]);

  // Sohbete gönderilecek belge bölümü: kısa belgede tamamı, uzun belgede
  // giriş + aktif satırın çevresi.
  const buildChatContext = () => {
    const textLines = linesLiveRef.current
      .map((l, i) => ({ l, i }))
      .filter((x) => x.l.kind === "text") as { l: { kind: "text"; text: string }; i: number }[];
    const all = textLines.map((x) => x.l.text).join("\n");
    if (all.length <= 6000) return all;
    let offset = 0;
    for (const x of textLines) {
      if (x.i >= activeRef.current) break;
      offset += x.l.text.length + 1;
    }
    const start = Math.max(0, offset - 2500);
    const around = all.slice(start, offset + 2500);
    return start > 1200
      ? all.slice(0, 1000) + "\n[…]\n" + around
      : all.slice(0, 6000);
  };

  const sendChat = async () => {
    const question = chatInput.trim();
    if (!question || chatBusy) return;
    setChatInput("");
    const history: ChatMessage[] = [
      ...chatMessages,
      { role: "user", content: question },
    ];
    setChatMessages(history);
    setChatBusy(true);
    try {
      const reply = await chatAboutDoc(
        doc.title,
        buildChatContext(),
        history.slice(-10), // bağlamı taze tut, istekleri küçük tut
      );
      setChatMessages([...history, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages([
        ...history,
        {
          role: "assistant",
          content: "Şu an yanıt veremedim — birazdan tekrar dener misin? 🙏",
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  // Satır notları: sağ tık / basılı tutma ile baloncuk açılır.
  const [notes, setNotes] = useState<Notes>(() => loadNotes(doc.id));
  const [bubble, setBubble] = useState<{ line: number; x: number; y: number } | null>(null);
  const [bubbleMode, setBubbleMode] = useState<"ask" | "edit">("ask");
  const [noteDraft, setNoteDraft] = useState("");
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const pressRef = useRef<{ timer: number; x: number; y: number }>({ timer: 0, x: 0, y: 0 });

  useEffect(() => saveNotes(doc.id, notes), [doc.id, notes]);

  const openBubble = useCallback(
    (line: number, x: number, y: number) => {
      const existing = notes[line];
      setBubble({
        line,
        x: Math.max(12, Math.min(x, window.innerWidth - 312)),
        y: Math.max(12, Math.min(y, window.innerHeight - 230)),
      });
      setBubbleMode(existing ? "edit" : "ask");
      setNoteDraft(existing ?? "");
    },
    [notes],
  );

  const saveBubbleNote = () => {
    if (!bubble) return;
    const text = noteDraft.trim();
    setNotes((prev) => {
      const next = { ...prev };
      if (text) next[bubble.line] = text.slice(0, 500);
      else delete next[bubble.line];
      return next;
    });
    setBubble(null);
  };

  const deleteBubbleNote = () => {
    if (!bubble) return;
    setNotes((prev) => {
      const next = { ...prev };
      delete next[bubble.line];
      return next;
    });
    setBubble(null);
  };

  // Mobil: satıra ~550ms basılı tutunca baloncuk aç.
  const pressHandlers = useCallback(
    (line: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        pressRef.current.x = e.clientX;
        pressRef.current.y = e.clientY;
        clearTimeout(pressRef.current.timer);
        pressRef.current.timer = window.setTimeout(
          () => openBubble(line, pressRef.current.x, pressRef.current.y),
          550,
        );
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (
          Math.abs(e.clientX - pressRef.current.x) > 10 ||
          Math.abs(e.clientY - pressRef.current.y) > 10
        ) {
          clearTimeout(pressRef.current.timer);
        }
      },
      onPointerUp: () => clearTimeout(pressRef.current.timer),
      onPointerCancel: () => clearTimeout(pressRef.current.timer),
    }),
    [openBubble],
  );

  // 🪄 Hikayeleştir: TÜM bölümlerin görselleri aynı anda üretilir; her biri
  // hazır olur olmaz kendi bölümünün arkasına yerleştirilir. Okuma bu sırada
  // devam edebilir.
  const runStorify = async () => {
    if (storify) return;
    const plan = planSegments(linesLiveRef.current);
    if (plan.length === 0) {
      showToast("Görselleştirmek için yeterli metin yok.");
      return;
    }
    storifyCancelled.current = false;
    setStorify({ done: 0, total: plan.length });
    showToast("🪄 Görsellerin hepsi aynı anda üretiliyor — okumaya devam et");

    const insertedPlanIdx = new Set<number>();
    let done = 0;
    let inserted = 0;
    // Yetkili kopya: setLines asenkron olduğu için kayıt anında state geride
    // kalabilir; eklemeleri kendi dizimizde de uygulayıp sonunda onu kaydederiz.
    let working = linesLiveRef.current;

    const runOne = async (k: number) => {
      // bir kez otomatik yeniden dene (geçici hız limitlerine karşı)
      for (let attempt = 0; attempt < 2; attempt++) {
        if (storifyCancelled.current) return;
        try {
          const scene = await describeScene(plan[k].excerpt);
          if (storifyCancelled.current) return;
          const src = await generateImage(scene);
          if (storifyCancelled.current) return;
          // Sıra dışı tamamlanmalar için yerleştirme: benden önceki
          // bölümlerden kaçının görseli çoktan eklendiyse o kadar kay.
          let shift = 0;
          for (const j of insertedPlanIdx) {
            if (plan[j].afterIndex < plan[k].afterIndex) shift++;
          }
          insertedPlanIdx.add(k);
          const insertAt = plan[k].afterIndex + 1 + shift;
          const next = working.slice();
          next.splice(insertAt, 0, { kind: "image", src });
          working = next;
          setLines(next);
          inserted++;
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
        }
      }
    };

    await Promise.all(
      plan.map((_, k) =>
        runOne(k).finally(() => {
          done++;
          setStorify((s) => (s ? { done, total: plan.length } : s));
        }),
      ),
    );

    setStorify(null);
    if (inserted > 0) {
      saveDocToLibrary({ id: doc.id, title: doc.title, lines: working });
      updateProgress(doc.id, activeRef.current, working.length);
      showToast(`✨ ${inserted} görsel hikayene eklendi`);
    } else if (!storifyCancelled.current) {
      showToast("Görsel üretilemedi — biraz sonra tekrar dene.");
    }
  };

  // Önce kısa link dener (aynı origin'deki sunucu ya da Supabase) — kısa
  // linkte görseller ve tablolar da taşınır. Servis yoksa/ulaşılamazsa
  // metin-only uzun linke düşer.
  const makeShareUrl = async (): Promise<{ url: string; mediaDropped: boolean } | null> => {
    const opts = {
      sender: shareName.trim() || undefined,
      note: shareNote.trim() || undefined,
    };
    const current = linesLiveRef.current;
    const hasMedia = current.some((l) => l.kind !== "text");

    // görselli (zengin) payload; boyut sınırını aşarsa metin-only payload
    let payload: string | null = null;
    let richSent = false;
    if (hasMedia) {
      payload = encodeSharePayload(doc.title, current, opts, true);
      richSent = payload !== null;
    }
    if (!payload) payload = encodeSharePayload(doc.title, current, opts, false);
    if (payload) {
      try {
        const created = await createShortLink(payload, {
          title: doc.title,
          sender: opts.sender,
          note: opts.note,
        });
        return {
          url: created.sameOriginServer
            ? pathShareUrl(created.id)
            : shortShareUrl(created.id),
          mediaDropped: hasMedia && !richSent,
        };
      } catch {
        // kısa link servisi ulaşılamazsa uzun linkle devam et
      }
    }

    const textOnly = encodeSharePayload(doc.title, current, opts, false);
    if (!textOnly) {
      showToast("Bu belge paylaşmak için çok büyük ya da metin içermiyor.");
      return null;
    }
    return { url: longShareUrl(textOnly), mediaDropped: hasMedia };
  };

  const copyShare = async () => {
    setSharing(true);
    const result = await makeShareUrl();
    setSharing(false);
    if (!result) return;
    setShareUrl(result.url);
    try {
      await navigator.clipboard?.writeText(result.url);
      showToast(
        result.mediaDropped
          ? "Link kopyalandı 🔗 (görseller sığmadığı için yalnızca metin)"
          : "Okuma linki kopyalandı 🔗 Artık birine atabilirsin!",
      );
    } catch {
      showToast("Kopyalanamadı — linki aşağıdaki kutudan seçip kopyala.");
    }
  };

  const nativeShare = async () => {
    setSharing(true);
    const result = await makeShareUrl();
    setSharing(false);
    if (!result) return;
    setShareUrl(result.url);
    const who = shareName.trim();
    navigator
      .share({
        title: doc.title,
        text: who
          ? `${who} sana bir okuma gönderdi: ${doc.title}`
          : `Sana bir okuma gönderildi: ${doc.title}`,
        url: result.url,
      })
      .then(() => setPanel("none"))
      .catch(() => {
        // kullanıcı vazgeçti ya da desteklenmiyor — sessizce geç
      });
  };

  const toastTimer = useRef(0);
  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

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
    for (const line of lines) sums.push(sums[sums.length - 1] + lineChars(line));
    return sums;
  }, [lines]);
  const remainingMin = Math.ceil(
    (cumulativeChars[lines.length] - cumulativeChars[active]) /
      (READING_CPS * SPEEDS[speedIdx] * 60),
  );

  const progress = lines.length > 1 ? active / (lines.length - 1) : 1;
  const soundMeta = AMBIENCES.find((a) => a.id === sound);
  const hasText = useMemo(() => lines.some((l) => l.kind === "text"), [lines]);

  // Satır listesi yalnızca içerik/bionic değişince yeniden kurulur; aktif
  // satır stilleri ref'ler üzerinden yönetildiği için scroll ucuzdur.
  const renderedLines = useMemo(
    () =>
      lines.map((line, i) => {
        const setRef = (el: HTMLElement | null) => {
          lineRefs.current[i] = el;
        };
        const noteProps = {
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            openBubble(i, e.clientX, e.clientY);
          },
          ...pressHandlers(i),
        };
        const marker = notes[i] && (
          <button
            className="line__note"
            title="Notunu gör"
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              openBubble(i, rect.left, rect.bottom + 8);
            }}
          >
            📌
          </button>
        );
        if (line.kind === "image") {
          return (
            <figure
              key={i}
              ref={setRef}
              className="line line--media"
              onClick={() => goTo(i)}
              {...noteProps}
            >
              <img src={line.src} alt="" />
              {marker}
            </figure>
          );
        }
        if (line.kind === "table") {
          return (
            <div key={i} ref={setRef} className="line line--media" onClick={() => goTo(i)} {...noteProps}>
              <div
                className="line--table"
                dangerouslySetInnerHTML={{ __html: line.html }}
              />
              {marker}
            </div>
          );
        }
        // Karaoke: söylenen kelime vurgulanır (bionic kapalıyken)
        const spoken =
          !bionic && ttsWord && ttsWord.line === i ? ttsWord : null;
        return (
          <p key={i} ref={setRef} className="line" onClick={() => goTo(i)} {...noteProps}>
            {spoken ? (
              <>
                {line.text.slice(0, spoken.start)}
                <mark className="line__spoken">
                  {line.text.slice(spoken.start, spoken.end)}
                </mark>
                {line.text.slice(spoken.end)}
              </>
            ) : bionic ? (
              bionicWords(line.text)
            ) : (
              line.text
            )}
            {marker}
          </p>
        );
      }),
    [lines, bionic, goTo, notes, openBubble, pressHandlers, ttsWord],
  );

  return (
    <div className="reader">
      <div className="reader__progress" style={{ width: `${progress * 100}%` }} />

      <header className="reader__top">
        <button className="iconBtn" onClick={onExit} title="Kapat (Esc)">
          ✕
        </button>
        <button
          className="iconBtn"
          onClick={() => setPanel((p) => (p === "share" ? "none" : "share"))}
          title="Birine gönder"
        >
          🔗
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
        onClick={() => {
          if (panel !== "none") setPanel("none");
          if (bubble) setBubble(null);
        }}
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
          {renderedLines}
        </div>
      </div>

      {panel === "voice" && (
        <div className="panel">
          <span className="panel__title">🗣️ Sesli okuma</span>
          <div className="chips">
            <button className="chip" onClick={() => startTts("simple")}>
              🔊 Basit okuma <span className="chip__sub">ücretsiz</span>
            </button>
            {premiumAvail && premiumPass && (
              <button
                className="chip chip--on"
                onClick={() => startTts("premium")}
              >
                ⭐ Premium okuma <span className="chip__sub">doğal ses</span>
              </button>
            )}
          </div>
          {premiumAvail && !premiumPass && (
            <>
              <span className="panel__title">⭐ Premium için şifre</span>
              <div className="chat__inputRow">
                <input
                  className="panel__input"
                  type="password"
                  placeholder="Premium şifresi…"
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void startPremium();
                  }}
                />
                <button
                  className="chip chip--on"
                  disabled={checking || !passInput.trim()}
                  onClick={() => void startPremium()}
                >
                  {checking ? "…" : "Aç"}
                </button>
              </div>
              {passErr && <p className="home__error">{passErr}</p>}
              <p className="panel__hint">
                Premium okuma çok daha doğal bir sesle (ElevenLabs) okur. Şifreyi
                yöneticiden al; bir kez girmen yeterli.
              </p>
            </>
          )}
          {premiumPass && (
            <p className="panel__hint">
              ⭐ Premium açık.{" "}
              <button
                className="linkBtn"
                onClick={() => {
                  localStorage.removeItem("readeasy:ttspass");
                  setPremiumPass("");
                }}
              >
                Şifreyi kaldır
              </button>
            </p>
          )}
        </div>
      )}

      {panel === "chat" && (
        <div className="panel panel--chat">
          <span className="panel__title">💬 Okuduğunla ilgili sohbet</span>
          <div className="chat__messages" ref={chatScrollRef}>
            {chatMessages.length === 0 && !chatBusy && (
              <p className="panel__hint">
                Belge hakkında istediğini sor: "Bunu özetler misin?", "Bu ne
                demek?", "Yazar burada ne anlatmak istiyor?"…
              </p>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`chatMsg chatMsg--${m.role}`}>
                {m.content}
              </div>
            ))}
            {chatBusy && (
              <div className="chatMsg chatMsg--assistant chatMsg--busy">
                Yazıyor…
              </div>
            )}
          </div>
          <div className="chat__inputRow">
            <input
              className="panel__input"
              placeholder="Sorunu yaz…"
              value={chatInput}
              maxLength={1000}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendChat();
              }}
            />
            <button
              className="chip chip--on"
              disabled={chatBusy || !chatInput.trim()}
              onClick={() => void sendChat()}
            >
              {chatBusy ? "…" : "Gönder"}
            </button>
          </div>
          <p className="panel__hint">
            Yanıtlar herkese açık ücretsiz bir AI servisinden gelir; sorunla
            birlikte belgeden bir bölüm bu servise gönderilir.
          </p>
        </div>
      )}

      {panel === "share" && (
        <div className="panel">
          <span className="panel__title">💌 Birine gönder</span>
          <input
            className="panel__input"
            placeholder="Adın (isteğe bağlı)"
            value={shareName}
            maxLength={60}
            onChange={(e) => setShareName(e.target.value)}
          />
          <textarea
            className="panel__input panel__note"
            placeholder='Kısa bir not — ör. "Al, şunu mutlaka oku 😊"'
            value={shareNote}
            maxLength={280}
            rows={2}
            onChange={(e) => setShareNote(e.target.value)}
          />
          <div className="chips">
            <button className="chip" disabled={sharing} onClick={() => void copyShare()}>
              {sharing ? "⏳ Hazırlanıyor…" : "📋 Linki kopyala"}
            </button>
            {"share" in navigator && (
              <button
                className="chip chip--on"
                disabled={sharing}
                onClick={() => void nativeShare()}
              >
                📤 Paylaş…
              </button>
            )}
          </div>
          {shareUrl && (
            <input
              className="panel__input panel__link"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
            />
          )}
          <p className="panel__hint">
            Linki açan kişi, notunla birlikte aynı okuma ekranını görür.
          </p>
        </div>
      )}

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
          <span className="panel__title">Okuma yardımı</span>
          <div className="chips">
            <button
              className={`chip ${bionic ? "chip--on" : ""}`}
              onClick={() => setBionic((b) => !b)}
            >
              🧠 Bionic okuma
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {bubble && (
        <div
          className="noteBubble"
          style={{ left: bubble.x, top: bubble.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {bubbleMode === "ask" ? (
            <>
              <p className="noteBubble__ask">
                Buraya küçük bir not eklemek ister misin? 📝
              </p>
              <div className="chips">
                <button
                  className="chip chip--on"
                  onClick={() => setBubbleMode("edit")}
                >
                  Not ekle
                </button>
                <button className="chip" onClick={() => setBubble(null)}>
                  Vazgeç
                </button>
              </div>
            </>
          ) : (
            <>
              <textarea
                className="panel__input"
                autoFocus
                rows={3}
                maxLength={500}
                placeholder="Notun… (yalnızca sende saklanır)"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setBubble(null);
                }}
              />
              <div className="chips">
                <button className="chip chip--on" onClick={saveBubbleNote}>
                  Kaydet
                </button>
                {notes[bubble.line] && (
                  <button className="chip" onClick={deleteBubbleNote}>
                    Sil
                  </button>
                )}
                <button className="chip" onClick={() => setBubble(null)}>
                  Kapat
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {storify && (
        <div className="storifyPill">
          <span className="storifyPill__spinner" />
          Görsel {storify.done}/{storify.total} üretiliyor…
          <button
            className="storifyPill__cancel"
            onClick={() => {
              storifyCancelled.current = true;
            }}
            title="İptal"
          >
            ✕
          </button>
        </div>
      )}

      {rsvp && (
        <Rsvp
          lines={lines}
          startLine={active}
          initialWpm={settings.rsvpWpm}
          onClose={(lineIndex) => {
            setRsvp(false);
            requestAnimationFrame(() => goTo(lineIndex, "auto"));
          }}
        />
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
          className={`iconBtn ${tts ? "iconBtn--live" : ""}`}
          onClick={() => {
            thump();
            if (ttsRef.current) {
              setTts(false);
            } else {
              setPassErr(null);
              setPanel((p) => (p === "voice" ? "none" : "voice"));
            }
          }}
          title="Sesli okuma"
        >
          🗣️
        </button>
        {hasText && (
          <button
            className="iconBtn"
            onClick={() => {
              thump();
              setPlaying(false);
              setTts(false);
              setRsvp(true);
            }}
            title="Hız modu — kelime kelime (RSVP)"
          >
            ⚡
          </button>
        )}
        {hasText && (
          <button
            className={`iconBtn ${panel === "chat" ? "iconBtn--live" : ""}`}
            onClick={() => setPanel((p) => (p === "chat" ? "none" : "chat"))}
            title="Okuduğunla ilgili AI sohbeti"
          >
            💬
          </button>
        )}
        {hasText && (
          <button
            className={`iconBtn ${storify ? "iconBtn--live" : ""}`}
            disabled={Boolean(storify)}
            onClick={() => {
              thump();
              void runStorify();
            }}
            title="Hikayeleştir — AI görselleriyle süsle"
          >
            🪄
          </button>
        )}
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
