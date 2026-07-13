/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Premium satın alma sayfası (ör. Stripe Payment Link). Boşsa buton bilgi notu gösterir. */
  readonly VITE_PREMIUM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
