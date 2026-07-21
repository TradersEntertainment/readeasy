# ReadEasy 🎵📖

Uzun metinleri, PDF ve Word dosyalarını **müzik uygulamalarındaki şarkı sözleri gibi** okuyun.
Aktif satır ekranın ortasında kocaman ve parlak durur; az önce okuduklarınız yukarıda
soluklaşır, birazdan okuyacaklarınız aşağıda bekler. Scroll, ok tuşları veya otomatik
akış ile metin bir şarkı gibi kayar.

## Özellikler

- 📄 **PDF, Word (.docx), TXT/MD** dosyası sürükle-bırak veya seç
- 📷 **Fotoğraftan oku (OCR)**: kitap sayfası, ders notu, tabela… fotoğrafını
  çek ya da seç; metin **tamamen cihazda** tanınır (Tesseract WASM, Türkçe +
  İngilizce; dil verisi ve çekirdek kendi sunucumuzdan gelir, CDN yok).
  Birden çok fotoğraf tek belge olarak birleşir; satır sonu tireleri ve
  satır kırılmaları otomatik temizlenir
- 🖼️ **PDF ve Word'deki görseller** akışın içinde kart olarak gösterilir
  (PDF'te sayfanın gömülü görselleri çıkarılır; sayfa metninin ardına eklenir)
- 📊 **Word tabloları** gerçek tablo olarak akışta yer alır (temizlenmiş HTML;
  PDF tabloları şimdilik metin olarak akar — güvenilir tablo tespiti PDF'te yok)
- 🗣️ **Sesli okuma (TTS)**: varsayılan **doğal ses** (sunucu, `/api/tts`
  üzerinden Google Translate TTS'i anahtarsız proxy'ler — Türkçe'de belirgin
  daha doğal); erişilemezse otomatik olarak **cihaz sesine** (Web Speech,
  kelime-kelime karaoke vurgusu, çevrimdışı) düşer. iOS ses kilidi buton
  tıklamasında açılır, klip süresi güvenlik ağıyla satır asla takılmaz
- 📋 Kopyala-yapıştır ile anında okuma
- 🔗 **Link'ten okuma**: makale linki ya da **ChatGPT / Claude / Gemini sohbet
  paylaşım linki** yapıştır → içerik çekilip kayışa dönüşür (önce doğrudan,
  CORS engellenirse [r.jina.ai](https://jina.ai/reader) okuyucu proxy'siyle;
  markdown tabloları gerçek tabloya çevrilir)
- ⚡ **RSVP hız modu**: kelimeler sabit odak noktasında tek tek akar
  (Spritz tarzı, ORP harfi vurgulu, 120–700 kelime/dk, noktalama duraklı)
- 🧠 **Bionic okuma**: kelimelerin ilk ~%40'ı kalın — odak kolaylaşır
- 📤 **Okuma linki paylaş**: metin sıkıştırılıp URL'e gömülür; linki açan
  aynı kayışı görür (sunucusuz, ~60K karaktere kadar)
- 🔥 **İstatistikler**: gün serisi (streak), toplam okuma süresi, kelime sayısı
- 🪄 **Hikayeleştir**: metin bölümlere ayrılır, her bölüm için AI görseli
  üretilip akışa serpiştirilir (ücretsiz [pollinations.ai](https://pollinations.ai);
  önce bölüm AI ile sahne tarifine çevrilir, sonra görsel üretilir; üretim
  arka planda sürer, okumaya devam edilebilir, iptal edilebilir)
- 🎤 Apple Music tarzı satır kayışı: aktif satır parlak, diğerleri soluk ve hafif bulanık
- ✂️ **Cümle temelli akış**: kaydırma yalnızca cümle sonlarında olur, cümleler asla
  ortadan bölünmez ("19. yüzyıl" gibi kalıplar ve kısaltmalar korunur)
- 🎧 **Ortam sesleri**: yağmur, okyanus, şömine, üretken piyano, beyaz/derin gürültü —
  tamamı Web Audio API ile sentezlenir, ses dosyası yok, **lisans sorunu yok**
- 🎨 **6 tema**: Gece, Okyanus, Orman, Gün Batımı, Kağıt (açık), Gece Yarısı (OLED)
- 📐 **Hizalama seçimi**: iki yana yaslı (varsayılan), sol, orta, sağ — Word'deki gibi
- ⏯️ **Kaldığın yerden devam**: son belge ve konum tarayıcıda saklanır
- ⏱️ Tahmini kalan okuma süresi
- ⌨️ Klavye: `↓ ↑` satır, `PgDn PgUp` 5 satır, `Boşluk` oynat/durdur, `+ −` yazı boyutu, `F` tam ekran, `Esc` çıkış
- ▶️ **Otomatik akış**: satır uzunluğuna göre kendi kendine ilerler (0.75× – 2× hız)
- 🖱️ Satıra tıklayınca oraya atlar; fare tekerleğiyle serbest gezinme
- 📱 PWA manifest'i ile "Ana ekrana ekle" desteği
- 🔒 Tamamen tarayıcıda çalışır — dosyalar hiçbir sunucuya gönderilmez

## Geliştirme

```bash
npm install
npm run dev
```

## Dağıtım (Deploy)

Uygulama tamamen statik bir Vite sitesidir; backend gerektirmez.

### Vercel

1. Repoyu Vercel'e import edin.
2. Framework preset otomatik olarak **Vite** seçilir (Build: `npm run build`, Output: `dist`).
3. Deploy — bitti.

### Railway (kısa linkler dahil — önerilen)

1. Repoyu Railway'e bağlayın (New Project → Deploy from GitHub repo).
2. Otomatik olarak `npm run build` ve `npm start` çalışır — `start`,
   `server.mjs` ile hem siteyi hem kısa link API'sini sunar.
3. Kalıcı paylaşım için servise **Volume** ekleyin (mount path: `/data`).

## Kısa Paylaşım Linkleri

Kısa linkler (`site.com/#s=Ab3kZ9Qw`) görselleri ve tabloları da taşır.
İki yol vardır; uygulama ikisini de kendiliğinden dener, hiçbiri yoksa
metin-only uzun (#d=) linke düşer:

### Yol A — Railway sunucusu (önerilen, sıfır yapılandırma)

Repo, `server.mjs` ile kendi mini sunucusunu içerir: statik siteyi sunar ve
paylaşımları diske kaydeder (`POST /api/shares`). Railway'de:

1. Repoyu Railway'e bağlayın — `npm run build` + `npm start` otomatik çalışır.
2. Servise bir **Volume** ekleyin, **mount path: `/data`** yazın. Hepsi bu;
   ortam değişkeni gerekmez. (Volume olmazsa paylaşımlar deploy'da silinir.)

> Vercel'de de statik bir kopya tutuyorsanız, oradan yapılan paylaşımların da
> kısa olması için Vercel ortam değişkenlerine Railway adresinizi ekleyin ve
> redeploy edin:
> `VITE_SHARE_API_URL=https://readeasy.up.railway.app`

### Yol B — Supabase (Vercel gibi statik barındırma için)

1. supabase.com'da proje aç → SQL Editor'de şunu çalıştır:

   ```sql
   create table public.shares (
     id text primary key,
     payload text not null check (length(payload) < 6000000),
     created_at timestamptz default now()
   );
   alter table public.shares enable row level security;
   create policy "anon insert" on public.shares for insert with check (true);
   create policy "anon read" on public.shares for select using (true);
   ```

   Tabloyu daha önce 200000 sınırıyla oluşturduysanız görselli paylaşımlar
   için sınırı büyütün:

   ```sql
   alter table public.shares drop constraint shares_payload_check;
   alter table public.shares add constraint shares_payload_check
     check (length(payload) < 6000000);
   ```

2. Project Settings → API'den URL ve anon anahtarını al; dağıtım ortamına ekle
   (Vercel/Railway ortam değişkenleri):

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

3. Yeniden deploy et. Değişkenler yoksa ya da servis ulaşılamazsa uygulama
   kendiliğinden uzun linke döner — paylaşım asla bozulmaz.

Kısa linkler aktifken paylaşımlar **görselleri ve tabloları da taşır**
(Hikayeleştir görselleri dahil, ~3-4 MB'a kadar). Uzun linkte yalnızca metin
taşınır ve kullanıcı bilgilendirilir. Linkten gelen içerik alıcı tarafta
doğrulanır (görsel kaynak şeması kısıtlanır, tablo HTML'i yeniden temizlenir).

## Gelir Modeli (Freemium)

- Günde **20 dk ücretsiz** okuma (`src/lib/premium.ts` → `FREE_SECONDS_PER_DAY`).
- Süre dolunca: **ödüllü reklam izle → +30 dk** ya da **Premium** (sınırsız + reklamsız).
- Reklam alanı şu an demo yer tutucudur; canlıda iOS'ta **AdMob rewarded**,
  web'de AdSense bağlanacak (`src/components/Paywall.tsx` içindeki AdSlot).
- Premium düğmesi `VITE_PREMIUM_URL` ortam değişkenindeki ödeme sayfasını açar
  (ör. Stripe Payment Link; başarı yönlendirmesi `/?premium=1`).
  ⚠️ Premium hakkı şimdilik localStorage'dadır — gerçek ödeme entegrasyonunda
  sunucu doğrulaması eklenmelidir. iOS uygulaması içinde satışın
  **Apple In-App Purchase** ile yapılması zorunludur.

## Native Dokunuşlar

- 📳 Satır geçişinde hafif, oynat/durdurda orta **titreşim** (iOS'ta Capacitor
  Haptics, web'de `navigator.vibrate`)
- 🔆 Okurken **ekran uyanık kalır** (web'de Wake Lock API, iOS'ta
  `isIdleTimerDisabled`)

## App Store'a Yayın (Mac gerektirmez)

Repo, [Capacitor](https://capacitorjs.com) ile native iOS projesi içerir (`ios/`)
ve derleme bulutta bir Mac'te yapılır — kendi Mac'inize gerek yoktur.

1. **Apple Developer Program** üyeliği alın (99 $/yıl) — iPhone veya herhangi
   bir bilgisayardan yapılabilir: developer.apple.com
2. **App Store Connect**'te uygulamayı oluşturun
   (Bundle ID: `com.tradersentertainment.readeasy`).
3. **Codemagic** hesabı açıp repoyu bağlayın; `codemagic.yaml` içindeki
   adımları izleyerek App Store Connect API anahtarını ekleyin.
   Ücretsiz katman (500 dk/ay macOS derleme) bu proje için fazlasıyla yeterli.
4. Workflow'u çalıştırın → imza sertifikaları otomatik oluşturulur, uygulama
   derlenir ve **TestFlight**'a yüklenir. iPhone'unuza TestFlight uygulamasını
   kurup denedikten sonra App Store incelemesine gönderin.

Alternatifler: GitHub Actions macOS runner + fastlane, ya da mağazasız dağıtım
için PWA (Safari → Paylaş → Ana Ekrana Ekle — bugün zaten çalışıyor).

## Teknolojiler

- [Vite](https://vitejs.dev) + [React](https://react.dev) + TypeScript
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF metin çıkarma (tarayıcıda)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — Word (.docx) metin çıkarma (tarayıcıda)
