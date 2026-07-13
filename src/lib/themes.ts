// Tema tanımları. Renklerin kendisi CSS'te ([data-theme="..."]) yaşar;
// burada yalnızca seçim arayüzü için ad ve örnek renkler tutulur.

export const THEMES = [
  { id: "gece", name: "Gece", swatch: ["#a78bfa", "#f472b6"] },
  { id: "okyanus", name: "Okyanus", swatch: ["#38bdf8", "#2dd4bf"] },
  { id: "orman", name: "Orman", swatch: ["#4ade80", "#a3e635"] },
  { id: "gunbatimi", name: "Gün Batımı", swatch: ["#fb923c", "#f43f5e"] },
  { id: "kagit", name: "Kağıt", swatch: ["#b45309", "#f6f0e2"] },
  { id: "geceyarisi", name: "Gece Yarısı", swatch: ["#8b5cf6", "#000000"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
}
