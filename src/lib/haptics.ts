// Dokunsal geri bildirim: native'de Capacitor Haptics, web'de (destekleyen
// tarayıcılarda) navigator.vibrate. Desteklenmeyen ortamlarda sessizce geçer.

import { Capacitor } from "@capacitor/core";

let lastTick = 0;

// Satır geçişlerinde çok hafif "tık" — 150 ms'den sık tetiklenmez ki hızlı
// kaydırmada titreşim bombardımanı olmasın.
export function tick() {
  const now = Date.now();
  if (now - lastTick < 150) return;
  lastTick = now;
  if (Capacitor.isNativePlatform()) {
    void import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) =>
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}),
    );
  } else {
    navigator.vibrate?.(8);
  }
}

// Oynat/durdur gibi belirgin eylemler için orta şiddette vuruş.
export function thump() {
  if (Capacitor.isNativePlatform()) {
    void import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) =>
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}),
    );
  } else {
    navigator.vibrate?.(20);
  }
}
