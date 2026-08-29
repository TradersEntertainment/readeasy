# ReadEasy — Tek Prompt ile Sıfırdan Üretim

> Bu dosya, ReadEasy projesinin **tamamını** hiç görmemiş bir yapay zekâya
> tek seferde verilebilecek üretim promptudur. Aşağıdaki metnin tamamını
> kopyalayıp modele verirsen çalışan bir ReadEasy çıkması beklenir.

---

Sen kıdemli bir ürün mühendisisin. Aşağıda tarif edilen uygulamayı **sıfırdan, eksiksiz ve çalışır** biçimde yaz. Soru sorma, varsayımlarını kendin yap ve bütün dosyaları üret. Kısayol alma, "TODO" bırakma, sahte/placeholder fonksiyon yazma — belirtilen her özellik gerçekten çalışsın.

## 0) Ürün tek cümlede

**ReadEasy**: uzun metinleri, PDF/Word dosyalarını, fotoğrafları ve web linklerini **müzik uygulamalarındaki şarkı sözleri gibi** okutan, Türkçe arayüzlü, tam ekran bir okuma uygulaması. Aktif satır ekranın ortasında kocaman ve parlak durur; okunanlar yukarıda soluklaşır, okunacaklar aşağıda bulanık bekler. Metin scroll, ok tuşları, otomatik akış ya da sesli okuma ile bir şarkı gibi kayar.

Ürün duygusu: Apple Music / Spotify şarkı sözü ekranı + Kindle + Spritz. Sakin, karanlık, sinematik, "her şeyden uzaklaşma" hissi. Tıklanacak yer az, ekran boş, yazı büyük.

## 1) Teknoloji ve sert kısıtlar

- **Vite 5 + React 18 + TypeScript 5**, `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `jsx: react-jsx`, `moduleResolution: bundler`, `noEmit`. Build: `tsc -b && vite build`.
- **Tek CSS dosyası** (`src/styles.css`), CSS değişkenleriyle tema. Tailwind YOK, CSS-in-JS YOK, UI kütüphanesi YOK, state kütüphanesi YOK, router YOK.
- Bağımlılıklar **tam olarak** şunlar (başka runtime bağımlılığı ekleme):
  `react`, `react-dom`, `pdfjs-dist` (^4.8), `mammoth` (^1.8), `tesseract.js` (^7), `lz-string`, `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/haptics`.
- **Sunucu tarafı sıfır bağımlılık**: `server.mjs` yalnızca Node 20+ yerleşiklerini kullanır (`node:http`, `node:fs/promises`, `node:path`, `node:crypto`, global `fetch`). Express YOK.
- **Gizli anahtar asla kodda değil** — yalnızca ortam değişkeni.
- Arayüz metinlerinin **tamamı Türkçe**, samimi ve kısa ("Bırak, okuyalım 📄", "Okuma linki kopyalandı 🔗"). Kod içi yorumlar da Türkçe ve "neden" anlatır, "ne" değil.
- Her ağ/tarayıcı API'si **kırılgan kabul edilir**: `try/catch`, sessiz düşme, mutlaka bir yedek yol. Uygulama hiçbir hata durumunda beyaz ekrana düşmez.

## 2) Dosya yapısı (birebir bu isimlerle üret)

```
index.html                  vite.config.ts        tsconfig.json      package.json
capacitor.config.ts         codemagic.yaml        server.mjs         README.md
scripts/copy-tesseract.mjs
public/  favicon.svg  icon-192.png  icon-512.png  manifest.webmanifest  tessdata/{tur,eng}.traineddata.gz
src/main.tsx  src/App.tsx  src/styles.css  src/mammoth-browser.d.ts  src/vite-env.d.ts
src/components/  Home.tsx  Reader.tsx  Rsvp.tsx  Paywall.tsx
src/lib/  doc.ts  text.ts  extract.ts  ocr.ts  url.ts  sanitize.ts  storage.ts
          premium.ts  stats.ts  social.ts  share.ts  shortlink.ts
          tts.ts  ambience.ts  themes.ts  haptics.ts  chat.ts  storify.ts
ios/  (Capacitor iOS projesi)
```

## 3) Çekirdek veri modeli (`src/lib/doc.ts`)

```ts
type Line =
  | { kind: "text";  text: string }
  | { kind: "image"; src: string }   // data: URL ya da https URL
  | { kind: "table"; html: string }; // temizlenmiş HTML

interface Doc { id: string; title: string; lines: Line[] }
```

- `newDocId()`: `crypto.getRandomValues` ile 10 karakterlik base62 kimlik.
- `blocksToLines(blocks)`: metin bloklarını `splitIntoLines` ile cümlelere böler, görsel/tablo bloklarını olduğu gibi geçirir.
- `lineChars(line)`: süre tahmini için ağırlık — metin uzunluğu, görsel 90, tablo 180.

Uygulamanın tamamı bu `Line[]` "kayışı" üzerine kuruludur: dosya, OCR, link, paylaşım — hepsi aynı modele indirgenir.

## 4) Cümle bölme kuralı (`src/lib/text.ts`) — ürünün kalbi

**Kural: her adım bir cümledir.** Kaydırma yalnızca cümle sonlarında olur; cümle asla ortadan kopmaz.

- Paragrafları `\n` ile ayır, iç boşlukları tek boşluğa indir.
- Cümle sonu regex'i: `/(?<=[.!?…]["”’')\]]*)\s+(?=[A-ZÇĞİÖŞÜ0-9“"'(«[])/u` — böylece `19. yüzyıl`, `3.14` bölünmez (noktadan sonra küçük harf/rakamsız durum gelmez).
- Kısaltma listesi (`Dr. Prof. Doç. Yrd. Av. Sn. Sok. Cad. Apt. No. vs. vb. örn. bkz. yy. Alb. Yzb. Gen. Mah. Age. Çev. Ed. Yay.`) ile yanlış bölünenleri geri birleştir.
- 340 karakteri aşan cümleyi virgül/noktalı virgül/iki nokta/tire duraklarından böl; 560'ı hâlâ aşan parçayı kelime sınırından böl.

## 5) Ana ekran — `src/components/Home.tsx`

Ortalanmış tek sütun, degrade zemin. İçerik sırası:

1. **Logo** `Read<span>Easy</span>` (span vurgu rengiyle), altında tagline.
2. **Sosyal kanıt**: sunucudan gelen gerçek okuma sayacı — `12,3B+ okuma yapıldı` (biçimlendirme: <1000 tam sayı, <1M `B`, üstü `Mn`, ondalıkta virgül). Sayaç 0/erişilemezse hiç gösterilme.
3. **Kişisel istatistik** (toplam süre ≥ 60 sn ise): `🔥 7 gün seri · ⏱ 240 dk okuma · 📚 52.000 kelime`.
4. **📚 Kitaplığın**: kayıtlı belgeler; her kart başlıktan **deterministik üretilen degrade kapak** (başlık karakterlerinden hash → `hsl(h 65% 52%)` → `hsl(h+50 70% 40%)`), ilerleme çubuğu + yüzde, ✕ ile silme. Karta tıklayınca kaldığı satırdan devam.
5. **Sahnelenmiş görseller** (varsa): küçük önizleme kartları (Gemini tarzı), her birinde ✕, sonda ＋ ekle butonu, altında `📖 Oku · N görsel`.
6. **Link satırı**: `🔗 Link yapıştır — makale, blog, X gönderisi, AI sohbeti…` + `Getir` (Enter da çalışır).
7. **Textarea**: metin yapıştırma.
8. **Aksiyonlar**: `Okumaya başla` · `Dosya seç (PDF · DOCX · TXT)` · `📷 Fotoğraftan oku` · `Örnekle dene`.
9. **Hata satırı** ve ipucu metni.

Davranış:
- Sayfanın tamamına **sürükle-bırak**; sürüklerken tam ekran `Bırak, okuyalım 📄` katmanı.
- **Ctrl/⌘+V** ile pano görselleri yakalanır (window `paste` dinleyicisi) ve sahnelenmiş kartlara eklenir; panoda görsel yoksa müdahale etme.
- Dosya yönlendirme: görseller sahnelenir (OCR için birikir), belgeler anında açılır.
- Görsellerin `objectURL`'leri kaldırılırken ve bileşen sökülürken `revokeObjectURL`.
- OCR başlığı: tek dosyada dosya adı; ad `image/screenshot/görüntü/photo/resim/ekran` ile başlıyorsa `Ekran görüntüsü`; birden fazlada `Taranan metin (N sayfa)`.
- **Örnekle dene** butonu, uygulamayı kendi kendini anlatan gömülü bir örnek metinle açar (kullanıcı deneyimi içinde öğrenir).
- Metin çıkmayan PDF için özel hata: *"Taranmış/görüntü PDF'lerde metin katmanı bulunmaz — sayfanın fotoğrafını çekip 📷 ile deneyin."*

## 6) Okuyucu — `src/components/Reader.tsx` (ürünün ana ekranı)

### 6.1 Karaoke kayışı (performans kritik)

- Yapı: `.reader__scroller` (tek scroll konteyneri) > `.reader__lines` (genişlik `min(56rem, 92vw)`, `padding: 50vh 0 55vh`, `gap: 1.4em`) > satırlar.
- Yazı: `font-weight: 800`, `letter-spacing: -0.02em`, `line-height: 1.28`, boyut `calc(clamp(1.5rem, 4.5vw, 3.6rem) * fontScale)`.
- Her satırın dikey merkezi **bir kez ölçülür** (`offsetTop + offsetHeight/2`) ve dizide tutulur; `ResizeObserver` ile yazı boyutu/pencere değişince yeniden ölçülür.
- Scroll'da **kare başına en fazla bir güncelleme** (`requestAnimationFrame` kilidi). Güncelleme:
  - Ekran ortasına en yakın satırı **ikili arama** ile bul → aktif satır.
  - Aktifin ±14 satırı için: `t = min(1, |merkez − orta| / (viewportYüksekliği × 0.55))`,
    `opacity = max(0.13, 0.6 × (1−t)^1.5)`, `filter = blur(t × 2.2px)`.
    Aktif satır: `opacity 1`, `blur yok`, `transform: scale(1)`, `text-shadow` ile vurgu ışıması.
  - Pencereden çıkan satırların satır içi stilleri temizlenir.
- **Bu stiller React state'i üzerinden DEĞİL, ref'ler üzerinden doğrudan DOM'a yazılır.** Satır listesi yalnızca içerik/bionic/not/karaoke değişince `useMemo` ile yeniden kurulur. 5.000 satırlık belgede bile scroll 60fps olmalı.
- Satıra tıklayınca oraya `smooth` kayar.

### 6.2 Üst bar / alt kontrol çubuğu

Üst: `✕ kapat` · `🔗 gönder` · belge başlığı · sayaç (`Ücretsiz: 12 dk · ≈18 dk · 43 / 512`). Üstte ince ilerleme çizgisi.

Alt (safe-area dolgulu, zemine degrade maske): `A−` `A+` `🎧 ortam sesi` `🗣️ sesli okuma` `⚡ RSVP` `💬 AI sohbet` `🪄 hikayeleştir` `▶/⏸` `1×` `🎨 tema` `⛶ tam ekran`. Aktif olan butonlar `iconBtn--live` ile parlar.

### 6.3 Klavye

`↓ → j` sonraki satır · `↑ ← k` önceki · `PgDn/PgUp` 5 satır · `Home/End` · `Boşluk` oynat/durdur (TTS açıksa durdurur) · `+ −` yazı boyutu (0.6–1.8, adım 0.1) · `F` tam ekran · `Esc` panel → baloncuk → çıkış sırasıyla kapatır. Bir input/textarea odaktayken kısayollar çalışmaz (yalnızca Esc blur eder). Paywall açıkken ve RSVP modundayken gezinme kilitlidir.

### 6.4 Otomatik akış

`ms = clamp(1700, 800 + satırKarakterSayısı × 55, 14000) / hız`, hızlar `[0.75, 1, 1.25, 1.5, 2]`. Son satırda kendini durdurur. TTS açıkken akışı TTS sürer.

### 6.5 Paneller (alt çubuğun üstünde açılan kartlar)

- **🎧 Ortam sesi**: 6 ses çipi + ses seviyesi kaydırıcısı.
- **🎨 Tema**: 6 renk yuvarlağı + hizalama çipleri (Sola / Ortala / Sağa / İki yana) + `🧠 Bionic okuma` anahtarı.
- **🔗 Birine gönder**: ad (60), not (280), `📋 Linki kopyala`, `📤 Paylaş…` (yalnızca `navigator.share` varsa), oluşan link salt-okunur kutuda.
- **🗣️ Sesli okuma**: `🔊 Basit okuma (ücretsiz)` ve — sunucuda mevcutsa — `⭐ Premium okuma (doğal ses)`; premium ilk kez seçilirken şifre sorulur.
- **💬 Sohbet**: mesaj listesi, "Yazıyor…" göstergesi, giriş satırı (1000 karakter), gizlilik uyarısı.

### 6.6 Ek okuyucu davranışları

- **Bionic okuma**: her kelimenin ilk `ceil(harfSayısı × 0.4)` (en az 1) karakteri `<b>`.
- **Satır notları**: sağ tık (masaüstü) ya da ~550 ms basılı tutma (dokunmatik) → baloncuk. Önce "Not eklemek ister misin?" sorusu, sonra 500 karakterlik metin alanı. Notlu satırda 📌 rozeti; not `readeasy:notes:<docId>` altında saklanır. Baloncuk ekran dışına taşmaz (`clamp`).
- **Titreşim**: satır geçişinde hafif (150 ms'den sık tetiklenmez), oynat/durdur gibi eylemlerde orta. Native'de Capacitor Haptics, web'de `navigator.vibrate`.
- **Wake Lock**: okurken ekran uyanık kalır; sekme geri görünür olunca kilit yeniden alınır.
- **İlerleme kaydı**: aktif satır her değiştiğinde kitaplık girdisi güncellenir.
- **İstatistik**: 5 saniyede bir (sekme görünürken) süre işlenir; ileri gidilen satırların kelimeleri sayılır.

## 7) Sesli okuma — `src/lib/tts.ts` (en zor parça, dikkatle uygula)

İki katman + iki motor:

1. **Sunucu sesi** (`GET /api/tts?lang=tr&tier=simple|premium&text=…`) → mp3. `tier=premium` ise `x-tts-pass` başlığı gider.
2. **Cihaz sesi** (Web Speech API) — sunucu erişilemezse o satır için devreye girer, `onboundary` ile kelime-kelime karaoke vurgusu verir.

Zorunlu davranışlar:

- **Tek kalıcı `Audio` nesnesi.** `primeAudio()` fonksiyonu, buton tıklamasının içinde **senkron** çağrılır ve çok kısa, geçerli bir **sessiz WAV data URL'i** çalar — iOS'un otomatik oynatma kilidi ancak böyle açılır. Sessiz klibi gecikmeli `pause()` ile durdurma (asıl sesi öldürür).
- **Kuyruk motoru React'ten bağımsız çalışır**: satır geçişi tamamen `speakDoc()` içinde döner, React yalnızca `onLine` / `onWord` geri çağrılarıyla takip eder. Aksi halde başka uygulamaya geçince okuma durur. Effect aktif satıra bağlanmaz (yoksa her satırda yeniden başlar).
- **Prefetch**: mevcut satır çalarken bir sonraki satırın sesi arka planda indirilip `Map` önbelleğinde bekletilir → satırlar arası boşluk kalmaz. Önbellek anahtarı `tier|metin`. Çift indirmeyi önlemek için yer tutucu kayıt.
- **Güvenlik ağı zamanlayıcısı**: `onended`/`onerror` gelmezse satır asla takılmasın diye `metinUzunluğu × 130 / hız + 4000 ms`; metadata yüklenince `(süre / hız) × 1000 + 900 ms` ile yeniden kur.
- **Ses tutarlılığı**: premium istendi ama sunucu Google'a düştüyse (`x-tts-provider: google`), belgenin **kalanı da** Google'da kalır — satırdan satıra ses değişmez.
- **Media Session**: kilit ekranı/kulaklık kontrolleri (`play`, `pause`, `nexttrack`, `previoustrack`), metadata başlık + `ReadEasy` + ikonlar. Böylece arka planda/kilit ekranında okuma sürer.
- `texts[i] === null` (görsel/tablo satırı) → 1600 ms sessiz duraklama.
- `playbackRate` 0.6–2 arası kırpılır, `preservesPitch = true` (tiz "sincap" sesi olmasın).
- `premiumAvailable()` → `GET /api/premium-check`, `checkPremiumPass(p)` → `POST /api/premium-check {pass}`. Doğru şifre `localStorage: readeasy:ttspass` altında saklanır, kullanıcı kaldırabilir.

## 8) RSVP hız modu — `src/components/Rsvp.tsx`

Tam ekran karartma, ortada tek kelime, üstte/altta ince kılavuz çizgiler. **ORP (optimal tanıma noktası)** harfi vurgu renginde: harf sayısı ≤1 → 0, ≤5 → 1, ≤9 → 2, üstü → 3.

Zamanlama: `60000 / wpm`; kelime 8 harften uzunsa ×1.3; cümle sonu noktalamasıyla bitiyorsa ×2.2; virgül/noktalı virgül ise ×1.5. Hız 120–700 k/dk (varsayılan 320, ok tuşlarıyla ±20). `Boşluk` oynat/durdur, `← →` kelime, `Esc` çıkış — çıkarken okuyucu, RSVP'nin kaldığı **satıra** konumlanır. Klavye dinleyicisi `capture` fazında ve olay yayılımı durdurulmuş olmalı (okuyucunun kısayollarıyla çakışmasın).

## 9) Ortam sesleri — `src/lib/ambience.ts`

**Hiçbir ses dosyası kullanılmaz** — hepsi Web Audio API ile gerçek zamanlı sentezlenir (lisans sorunu yok, paket boyutu artmaz). Tek `AmbienceEngine` sınıfı, master gain üzerinden 0.1–0.4 sn'lik yumuşak giriş/çıkış.

- 🌧️ **Yağmur**: pembe gürültü + bant geçiren filtre + rastgele damla vuruşları.
- 🌊 **Okyanus**: kahverengi gürültü + yavaş LFO ile dalga kabarması.
- 🔥 **Şömine**: kahverengi gürültü + rastgele çıtırtı zarfları.
- 🎹 **Piyano**: 10 notalı pentatonik-benzeri skaladan (130.81 … 659.25 Hz) rastgele, üretken, yumuşak zarflı notalar.
- 🌫️ **Beyaz gürültü**, 🌰 **Derin (kahverengi) gürültü**.

Gürültü tamponları 8 saniyelik döngü olarak bir kez üretilir (pembe için Paul Kellet yaklaşımı). Okuyucudan çıkarken ses durur.

## 10) Temalar ve görsel dil — `src/lib/themes.ts` + `src/styles.css`

Tema `document.documentElement.dataset.theme` ile uygulanır; her tema **aynı değişken setini** tanımlar: `--bg-1 --bg-2 --bg-3 --accent --accent-2 --text --muted --ink-rgb --shade-rgb --on-accent`.

| id | ad | bg-1 | accent | accent-2 |
|---|---|---|---|---|
| `gece` (varsayılan) | Gece | `#0b0b12` | `#a78bfa` | `#f472b6` |
| `okyanus` | Okyanus | `#06131d` | `#38bdf8` | `#2dd4bf` |
| `orman` | Orman | `#0a120d` | `#4ade80` | `#a3e635` |
| `gunbatimi` | Gün Batımı | `#160d0d` | `#fb923c` | `#f43f5e` |
| `kagit` | Kağıt (açık) | `#f6f0e2` | `#b45309` | `#c2410c` |
| `geceyarisi` | Gece Yarısı (OLED) | `#000000` | `#8b5cf6` | `#06b6d4` |

Ana sayfa zemini: iki radyal degrade (accent %18 ve accent-2 %14, `color-mix`) + 160° lineer degrade. Sistem font yığını. Tüm sabit çubuklarda `env(safe-area-inset-*)` dolgusu. `body { overflow: hidden }` — kaydırma yalnızca kendi konteynerlerinde.

## 11) İçerik çıkarma — `src/lib/extract.ts`

Her şey **tarayıcıda**; dosya hiçbir sunucuya gitmez.

- **PDF** (pdf.js, worker `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`):
  - Metin `getTextContent()`; `hasEOL` bilgisi satır sonuna çevrilir.
  - Görseller `getOperatorList()` içindeki `OPS.paintImageXObject` çağrılarından; `page.objs.get` **3 sn zaman aşımıyla** sarılır (bazı nesneler asılı kalır). Bitmap ya da ham RGBA/RGB/Gri veri canvas'a çizilip `image/jpeg, 0.85` data URL olur.
  - Kotalar: belge başına en fazla 40 görsel, 80px'den küçükler atlanır, uzun kenar 1400px'e küçültülür. Görseller ilgili sayfanın metninden **sonra** akışa girer.
- **DOCX** (`mammoth/mammoth.browser` → HTML, görseller base64 gömülü):
  `<table>` → temizlenmiş tablo bloğu, `<img>` → görsel bloğu, diğerleri metin tamponuna. Tampon, görsel/tablo gelmeden önce boşaltılır (sıra korunur).
- `.doc` için anlaşılır hata: *"Eski .doc formatı desteklenmiyor. Word'de .docx veya .pdf olarak kaydedin."*
- Diğer her şey düz metin.

## 12) OCR — `src/lib/ocr.ts` + `scripts/copy-tesseract.mjs`

- Tesseract.js worker'ı `tur` + `eng` dilleriyle. **CDN kullanma**: `workerPath: /tesseract/worker.min.js`, `corePath: /tesseract/core`, `langPath: /tessdata`.
- `predev`/`prebuild` betiği `node_modules`'ten worker ve `tesseract-core*.{js,wasm}` dosyalarını `public/tesseract/` altına kopyalar. Dil verileri (`tur.traineddata.gz`, `eng.traineddata.gz`) repoda `public/tessdata/` içinde tutulur. Böylece OCR **çevrimdışı** da çalışır.
- Fotoğraf ön işleme: `createImageBitmap(file, { imageOrientation: "from-image" })` ile EXIF yönü uygulanır, uzun kenar 2200px'e indirilir.
- Çıktı temizliği: satır sonu tiresi birleştirilir (`-\n` + küçük harf → bitişik), satır içi kırılmalar boşluğa döner, **paragraf sınırları korunur** (geçici işaretle).
- İlerleme mesajları: `Metin tanıma motoru yükleniyor…`, `Sayfa 2/5 tanınıyor…`. Birden çok görsel `\n\n` ile tek belgeye birleşir. Worker sonunda `terminate()`.

## 13) Linkten okuma — `src/lib/url.ts`

Sıralı strateji:

1. **Doğrudan `fetch`** (CORS'a açık siteler). HTML ise: `script/style/noscript/nav/footer/header/aside/form` çıkarılır, `article` → `main` → `body` sırasıyla kök seçilir, `h1-h6,p,li,blockquote,pre` metinleri toplanır. 400 karakterden azsa başarısız say.
2. **`https://r.jina.ai/<url>`** okuyucu proxy'si → temiz markdown. `Title:` satırı başlık, `Markdown Content:` sonrası gövde. Markdown → bloklar: başlık/alıntı/bağlantı/vurgu işaretleri temizlenir, `![](https://…)` görselleri akışa kart olur (svg hariç, en fazla 30), `|` ile başlayan satır blokları **gerçek HTML tablosuna** çevrilir (hücreler `textContent` ile yazılır → HTML enjeksiyonu imkânsız).
3. **X/Twitter**: doğrudan fetch atlanır; Jina yetmezse `publish.twitter.com/oembed` (yine Jina üzerinden, CORS kapalı) ile en azından ilk gönderi alınır ve kullanıcıya thread'in tamamı için ekran görüntüsü/yapıştırma önerilir.

AI sohbet linkleri (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`, `g.co`, `grok.com`, `chat.deepseek.com`, `copilot.microsoft.com`, `perplexity.ai`) tanınır, başlıkları `AI Sohbeti` olur. Hata mesajı kullanıcıya *"normal sohbet linki değil, 'Paylaş' ile oluşturulan link gerekir"* der. URL normalize edilir (şemasız girdiye `https://` eklenir, yalnızca http/https).

## 14) Güvenlik — `src/lib/sanitize.ts`

Tablo HTML'i için **beyaz listeli** temizleyici (hem dosyadan gelen hem paylaşım linkinden gelen — ikincisi tamamen güvenilmezdir):

- İzinli etiketler: `TABLE THEAD TBODY TFOOT TR TD TH P BR STRONG B EM I U SPAN COL COLGROUP`.
- İçeriğiyle **tamamen silinen** etiketler: `SCRIPT STYLE IFRAME OBJECT EMBED LINK META SVG MATH FORM INPUT BUTTON TEXTAREA SELECT TEMPLATE`.
- Diğer izinsiz etiketler içerikleri korunarak açılır (unwrap).
- `colspan`/`rowspan` dışındaki **tüm** öznitelikler silinir (böylece `on*`, `style`, `href` kalmaz).

Paylaşım linkinden gelen her satır ayrıca doğrulanır: metin 5000 karaktere kırpılır, görsel `src` yalnızca `data:image/` veya `https://` olabilir, tablo HTML'i yeniden temizlenir.

## 15) Yerel depolama — `src/lib/storage.ts`

`localStorage` anahtarları: `readeasy:settings`, `readeasy:library`, `readeasy:doc:<id>`, `readeasy:notes:<id>`, `readeasy:stats`, `readeasy:usage`, `readeasy:premium`, `readeasy:visited`, `readeasy:ttspass`.

- **Ayarlar**: tema, yazı ölçeği, hız indeksi, ortam sesi, ses seviyesi, hizalama (varsayılan `justify`), bionic, RSVP hızı, paylaşım adı. Varsayılanlarla birleştirilerek okunur.
- **Kitaplık**: girdi = `{id, title, savedAt, lastReadAt, pos, total, chars}`, son okunana göre sıralı. Belge başına üst sınır 3.000.000 karakter (aşan belge yalnızca oturumluk), toplam bütçe 4.200.000 karakter. Bütçe aşılınca **en uzun süredir okunmayan** belgeler silinir (LRU). Kota hatasında: diğer her şeyi boşalt, bir kez daha dene, yine olmazsa sessizce vazgeç.
- Eski tek-belge kayıtlarını (`readeasy:doc`, `readeasy:pos`) kitaplığa taşıyan bir **migrasyon** yaz.
- Her `localStorage` erişimi `try/catch` içinde — depolama kapalıysa uygulama yine çalışır.

## 16) Paylaşım — `src/lib/share.ts` + `src/lib/shortlink.ts`

İçerik `lz-string`'in `compressToEncodedURIComponent`'i ile sıkıştırılır. İki taşıma biçimi:

- `#d=<payload>` — **uzun link**, içerik URL'in kendisinde, sunucusuz. Yalnızca metin, en fazla 60.000 karakter.
- `#s=<kod>` veya `/s/<kod>` — **kısa link**, içerik sunucuda. Görseller ve tablolar dahil tüm kayış taşınır (sıkıştırılmış ~4 MB'a kadar).

Payload biçimleri: `{t, x, s?, n?}` (yalnızca metin, eski linklerle uyumlu) ve `{t, l, s?, n?}` (tam satır listesi). `s` = gönderen adı, `n` = not.

Kısa link backend'i sırayla denenir: (1) aynı origin'deki `POST /api/shares`, (2) Supabase REST (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` tanımlıysa). Hiçbiri yoksa uzun linke düşülür ve kullanıcıya *"görseller sığmadığı için yalnızca metin"* denir. **Paylaşım asla tamamen başarısız olmaz.**

Link açıldığında: URL temizlenir (`history.replaceState`), belge açılır ve üstüne **💌 davet kartı** gelir — `Ahmet sana bir okuma gönderdi`, notu, başlığı, `Okumaya başla ▶`. Kullanıcı bu tarayıcıda uygulamayı **ilk kez** açıyorsa, davet kapandıktan sonra alt köşede nazik bir tanıtım şeridi belirir: *"✨ Bu deneyim ReadEasy — kendi yazılarını, PDF'lerini, hatta ekran görüntülerini de böyle akıcı okuyabilirsin"* + `Dene`. Bu, ürünün büyüme döngüsüdür.

## 17) AI özellikleri (anahtarsız, ücretsiz servis)

- **💬 Sohbet** (`src/lib/chat.ts`): `POST https://text.pollinations.ai/` (`model: "openai"`). Sistem istemi Türkçe, "belgeye dayan, uydurma, kısa yanıtla, kullanıcının dilinde yanıtla" der. Bağlam kurulumu: belge 6000 karakterden kısaysa tamamı; uzunsa **giriş 1000 karakter + aktif satırın çevresinden ±2500 karakter**. Son 10 mesaj gönderilir, 45 sn zaman aşımı, yanıt 4000 karaktere kırpılır. Panelde gizlilik uyarısı gösterilir.
- **🪄 Hikayeleştir** (`src/lib/storify.ts`): metin bitişik bölümlere ayrılır (satır sayısı ÷ 6, en az 3, en çok 14), her bölümden 500 karakterlik alıntı alınır. Sonra: `text.pollinations.ai` ile alıntı **tek cümlelik İngilizce görsel istemine** çevrilir (max 25 kelime), ardından `image.pollinations.ai/prompt/<istem>?width=896&height=640&nologo=true&seed=…` ile görsel üretilir ve **data URL**'e çevrilir. Sabit stil eki: `, cinematic digital illustration, atmospheric lighting, high detail, no text, no watermark`.
  - **Tüm bölümler paralel** üretilir; her görsel hazır olur olmaz kendi bölümünün arkasına eklenir. **Sıra dışı tamamlanmalar için kaydırma hesabı yap**: benden önceki bölümlerden kaçının görseli zaten eklendiyse ekleme indeksi o kadar kayar.
  - Okuma bu sırada devam eder. Alt köşede `Görsel 4/12 üretiliyor…` hapı + ✕ iptal. Hata durumunda 2–5 sn rastgele bekleyip bir kez daha dener. Bittiğinde belge görselleriyle birlikte kitaplığa kaydedilir.

## 18) Gelir modeli — `src/lib/premium.ts` + `src/components/Paywall.tsx`

- Günde **20 dakika** ücretsiz okuma (`FREE_SECONDS_PER_DAY`), sayaç `YYYY-MM-DD` ile günlük sıfırlanır.
- Süre dolunca tam ekran paywall: `🎬 Reklam izle · +30 dk` veya `⭐ Premium'a geç` veya `Ana sayfaya dön`.
- Ödüllü reklam şimdilik **geri sayımlı demo yer tutucu** (5 sn); yorumda entegrasyon noktası açıkça belirtilir (iOS'ta AdMob rewarded, web'de AdSense).
- Ödül matematiği: sayaç kotayı ne kadar aşmış olursa olsun kullanıcıda **tam 30 dakika** kalacak şekilde bonus verilir.
- Premium butonu `VITE_PREMIUM_URL` (ör. Stripe Payment Link, başarı yönlendirmesi `/?premium=1`). Değişken yoksa bilgilendirme notu gösterilir.
- `?premium=1` ile gelindiğinde hak `localStorage`'a yazılır ve URL temizlenir. **Kodda açıkça uyar**: bu geçicidir; gerçek entegrasyonda sunucu doğrulaması şart, iOS'ta Apple In-App Purchase zorunludur.

## 19) Sunucu — `server.mjs` (Node yerleşikleri, sıfır bağımlılık)

Statik `dist/` sunar + şu API'yi verir:

| Yol | Davranış |
|---|---|
| `POST /api/shares` | `{payload, title?, sender?, note?}` → `{id}`. 8 karakterlik base62 kimlik, veri dizinine JSON dosya. IP başına **saatte 60** oluşturma sınırı (429), gövde sınırı ~6,5 MB (413). |
| `GET /api/shares/:id` | `{payload}`. Hem yeni (JSON) hem eski (düz metin) kayıt biçimini okur. |
| `GET /s/:id` | Uygulama sayfasını, o paylaşıma özel **Open Graph** etiketleriyle sunar (WhatsApp/iMessage zengin önizleme). Tüm değerler HTML-escape'lenir. |
| `GET /api/tts` | Aşağıya bak. |
| `GET/POST /api/premium-check` | GET → `{available}`; POST `{pass}` → `{ok, available}`. |
| `GET /api/stats` · `POST /api/read` | Gerçek okuma sayacı; IP başına kısa aralık sınırı, diske toplu yazım. `STATS_SEED` (varsayılan 100) başlangıç ivmesi verir — uydurma değil, gerçek sayacın tabanı. |
| `GET /api/health` | `{ok:true}` |

Veri dizini: `DATA_DIR` → `/data` (Railway volume) → yazılamıyorsa `./data`.

**`/api/tts` mantığı** (metin 600 karaktere kırpılır, `lang` `^[a-z]{2}(-[A-Z]{2})?$` ile doğrulanır):

1. **Disk önbelleği** `/data/ttscache/<sha>.mp3`. Anahtar sağlayıcı etiketi + dil + metinden üretilir. Premium istek **yalnızca** ElevenLabs önbelleğinden, basit istek **yalnızca** Google önbelleğinden okur — katmanlar asla karışmaz.
2. **Premium** (`tier=premium` + doğru şifre + `ELEVENLABS_API_KEY` varsa): ElevenLabs, geçici hataya karşı 2 deneme.
3. **Yedek**: anahtarsız **Google Translate TTS** proxy'si. ~200 karakter sınırı vardır → metin 190 karakterlik parçalara **kelime sınırından** bölünür, mp3 parçaları arka arkaya birleştirilir.
4. Yanıt başlıkları: `x-tts-provider` (elevenlabs/google), `x-tts-cache` (hit/miss), hata varsa `x-tts-error` (ASCII'ye indirgenmiş). Ses **gerçek üreticisinin** anahtarıyla önbelleğe yazılır.
5. Anahtarda ASCII dışı karakter varsa (yanlış yapıştırma) erken ve anlaşılır hata ver — `fetch` başlık kodlaması çöker.

Ortam değişkenleri: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` (vars. `eleven_multilingual_v2`), `PREMIUM_PASSWORD`, `STATS_SEED`, `DATA_DIR`, `PORT`; ayrıca genel sağlayıcı için `TTS_API_URL`, `TTS_API_KEY`, `TTS_HEADER`, `TTS_CONTENT_TYPE`, `TTS_BODY` (`{{text}}` yer tutuculu), `TTS_VOICE`. Öncelik: **ElevenLabs → genel sağlayıcı → Google**; her biri başarısız olursa bir sonrakine düşülür.

Frontend değişkenleri: `VITE_SHARE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PREMIUM_URL`.

## 20) PWA, iOS ve dağıtım

- `manifest.webmanifest` (standalone, `#0b0b12`, 192/512 ikon, 512 `any maskable`), `apple-touch-icon`, `apple-mobile-web-app-capable`, `viewport-fit=cover`, `theme-color`.
- **Capacitor iOS**: `appId: com.tradersentertainment.readeasy`, `appName: ReadEasy`, `webDir: dist`, `ios: { contentInset: "never", backgroundColor: "#0b0b12" }`. `AppDelegate.swift` içinde `application.isIdleTimerDisabled = true` (okuma uygulaması — ekran kararmasın).
- **`codemagic.yaml`**: `mac_mini_m2`, `app_store_connect` entegrasyonu ile Mac'siz derleme. Adımlar: `npm ci && npm run build` → `npx cap sync ios` → `keychain initialize` + `app-store-connect fetch-signing-files --type IOS_APP_STORE --create` + `xcode-project use-profiles` → `agvtool` ile sürüm → `xcode-project build-ipa` → TestFlight'a yayın. Dosyanın başına kurulum adımlarını Türkçe yorum olarak yaz.
- **README.md**: Türkçe, emojili özellik listesi; Vercel ve Railway dağıtımı; kısa link için iki yol (Railway volume `/data` — sıfır yapılandırma; ya da Supabase, `shares` tablosu SQL'i ve RLS politikalarıyla birlikte); TTS sağlayıcı kurulumu; gelir modeli; App Store yayın adımları.

## 21) Kabul kriterleri (bunların hepsi elle doğrulanabilir olmalı)

1. Uzun bir metin yapıştır → her satır **tam bir cümle**; `19. yüzyıl` veya `Dr. Ahmet` hiçbir yerde bölünmemiş.
2. 3.000 satırlık bir belgede hızlı scroll → takılma yok, aktif satır her zaman ekranın tam ortasındaki satır.
3. Görselli bir PDF aç → görseller ait oldukları sayfanın metninden sonra kart olarak akışta.
4. Word tablosu olan bir `.docx` aç → tablo gerçek tablo olarak render ediliyor, içinde hiçbir `style`/`on*` özniteliği yok.
5. Telefonda bir kitap sayfasının fotoğrafını çek → metin **cihazda** tanınıyor, ağ isteği yok, satır sonu tireleri birleşmiş.
6. 🗣️ ile sesli okumayı başlat → satırlar **arasında boşluk yok** (prefetch çalışıyor), telefonu kilitle → okuma devam ediyor ve kilit ekranında oynat/duraklat/ileri/geri çalışıyor.
7. Premium şifresini gir → ses ElevenLabs; ElevenLabs düşerse belgenin kalanı Google'da kalıyor, satır başına ses değişmiyor.
8. Bir belgeyi paylaş → link kopyalanıyor; başka bir tarayıcıda açınca aynı kayış + 💌 davet kartı + (ilk ziyaretse) tanıtım şeridi görünüyor.
9. Elle bozulmuş bir `#d=` payload'ı ile gel → uygulama çökmüyor, ana sayfa açılıyor.
10. ⚡ RSVP'yi aç, biraz oku, `Esc` → okuyucu tam kaldığın satırda.
11. 🪄 Hikayeleştir'i başlat → okumaya devam edilebiliyor, görseller **doğru bölümlerin** arkasına giriyor (sıra dışı tamamlanmalarda da), ✕ ile iptal edilebiliyor.
12. `localStorage`'ı devre dışı bırak → uygulama yine açılıyor ve okunuyor.
13. `npm run build` sıfır TypeScript hatasıyla geçiyor.

## 22) Kod kalitesi beklentisi

- Bileşenler küçük ve okunur; ağır işler `src/lib/` altında saf modüllerde.
- Yorumlar Türkçe ve **niyeti** anlatır: "iOS ses kilidini buton tıklamasında aç", "setLines asenkron olduğu için yetkili kopya tut", "kısaltmadan sonra yanlış bölünmeyi geri al".
- `any` yok; `unknown` + daraltma kullan. Dış dünyadan (link, payload, API) gelen her veri şekil doğrulamasından geçer.
- Her `fetch` zaman aşımlı ya da `AbortController`'lı; her `catch` bir yedek davranış üretir, sessizce yutmaz.
- `URL.createObjectURL` kullanan her yer `revokeObjectURL` ile eşleşir.

---

Şimdi bu uygulamayı baştan sona yaz.
