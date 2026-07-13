// Okuma istatistikleri: toplam süre, okunan kelime, gün serisi (streak).

const KEY = "readeasy:stats";

export interface Stats {
  totalSeconds: number;
  words: number;
  lastDay: string;
  streak: number;
}

const EMPTY: Stats = { totalSeconds: 0, words: 0, lastDay: "", streak: 0 };

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function save(stats: Stats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // önemsiz
  }
}

// Bugün ilk kez okunuyorsa seriyi günceller: dün de okunduysa +1, yoksa 1.
function touchDay(stats: Stats) {
  const today = new Date().toISOString().slice(0, 10);
  if (stats.lastDay === today) return;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  stats.streak = stats.lastDay === yesterday ? stats.streak + 1 : 1;
  stats.lastDay = today;
}

export function trackSeconds(seconds: number) {
  const stats = loadStats();
  stats.totalSeconds += seconds;
  touchDay(stats);
  save(stats);
}

export function trackWords(count: number) {
  if (count <= 0) return;
  const stats = loadStats();
  stats.words += count;
  touchDay(stats);
  save(stats);
}
