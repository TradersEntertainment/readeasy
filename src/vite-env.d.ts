/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Premium satın alma sayfası (ör. Stripe Payment Link). Boşsa buton bilgi notu gösterir. */
  readonly VITE_PREMIUM_URL?: string;
  /** Kısa paylaşım linkleri için Supabase proje URL'i. Boşsa uzun link kullanılır. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) anahtarı. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
