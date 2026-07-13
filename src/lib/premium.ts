// Ücretsiz kullanım kotası + premium üyelik durumu.
//
// Model: günde FREE_SECONDS_PER_DAY saniye ücretsiz okuma. Süre dolunca
// kullanıcı ya ödüllü reklam izleyip AD_REWARD_SECONDS kazanır ya da
// premium'a geçer (sınırsız + reklamsız).
//
// NOT: Şimdilik durum localStorage'da tutulur. Gerçek ödeme entegrasyonu
// (iOS'ta Apple In-App Purchase, web'de Stripe) bağlandığında premium
// hakkı sunucu tarafında doğrulanmalıdır.

export const FREE_SECONDS_PER_DAY = 20 * 60; // günlük ücretsiz süre
export const AD_REWARD_SECONDS = 30 * 60; // reklam başına kazanılan süre

const PREMIUM_KEY = "readeasy:premium";
const USAGE_KEY = "readeasy:usage";

interface Usage {
  date: string; // YYYY-MM-DD — gün değişince sayaç sıfırlanır
  seconds: number; // bugün okunan süre
  bonus: number; // reklamlardan kazanılan ek süre
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadUsage(): Usage {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const usage = JSON.parse(raw) as Usage;
      if (usage.date === todayKey()) return usage;
    }
  } catch {
    // bozuk kayıt → sıfırla
  }
  return { date: todayKey(), seconds: 0, bonus: 0 };
}

function saveUsage(usage: Usage) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // kota dolduysa sessizce geç
  }
}

export function isPremium(): boolean {
  try {
    return localStorage.getItem(PREMIUM_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPremium(value: boolean) {
  try {
    if (value) localStorage.setItem(PREMIUM_KEY, "1");
    else localStorage.removeItem(PREMIUM_KEY);
  } catch {
    // önemsiz
  }
}

export function addReadingSeconds(seconds: number) {
  const usage = loadUsage();
  usage.seconds += seconds;
  saveUsage(usage);
}

// Reklam ödülü: sayaç kotayı ne kadar aşmış olursa olsun, izleme sonrası
// kullanıcıda tam AD_REWARD_SECONDS kalacağını garanti eder.
export function grantAdReward() {
  const usage = loadUsage();
  usage.bonus = Math.max(
    usage.bonus + AD_REWARD_SECONDS,
    usage.seconds - FREE_SECONDS_PER_DAY + AD_REWARD_SECONDS,
  );
  saveUsage(usage);
}

export function remainingSeconds(): number {
  if (isPremium()) return Infinity;
  const usage = loadUsage();
  return FREE_SECONDS_PER_DAY + usage.bonus - usage.seconds;
}
