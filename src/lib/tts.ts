// Sesli okuma (TTS).
//
// v1 — ÜCRETSİZ katman: tarayıcının yerleşik Web Speech API'si. Ek maliyet
// yok; ses kalitesi cihaza göre değişir (iOS/macOS'ta Siri sesleri oldukça
// iyidir, Türkçe "Yelda" sesi vardır).
//
// v2 — PREMIUM katman (entegrasyon noktası): Google Cloud TTS / Azure /
// ElevenLabs gibi neural sesler. API anahtarı istemciye ASLA konmaz;
// küçük bir backend proxy'si (ör. Railway) metni alır, kullanıcının premium
// hakkını ve aylık karakter kotasını doğrular, sesi mp3 olarak stream eder.
// Bu dosyadaki speak/cancel arayüzü aynı kalır — yalnızca uygulaması
// fetch tabanlı sağlayıcıyla değiştirilir.

let cancelledToken = { cancelled: false };

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith("tr")) ??
    voices.find((v) => v.default) ??
    null
  );
}

export function speak(text: string, rate: number, onDone: () => void) {
  cancel();
  const token = { cancelled: false };
  cancelledToken = token;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  const done = () => {
    if (!token.cancelled) onDone();
  };
  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.speak(utterance);
}

export function cancel() {
  cancelledToken.cancelled = true;
  if (ttsAvailable()) window.speechSynthesis.cancel();
}
