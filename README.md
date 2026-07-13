# ReadEasy 🎵📖

Uzun metinleri, PDF ve Word dosyalarını **müzik uygulamalarındaki şarkı sözleri gibi** okuyun.
Aktif satır ekranın ortasında kocaman ve parlak durur; az önce okuduklarınız yukarıda
soluklaşır, birazdan okuyacaklarınız aşağıda bekler. Scroll, ok tuşları veya otomatik
akış ile metin bir şarkı gibi kayar.

## Özellikler

- 📄 **PDF, Word (.docx), TXT/MD** dosyası sürükle-bırak veya seç
- 📋 Kopyala-yapıştır ile anında okuma
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

### Railway

1. Repoyu Railway'e bağlayın (New Project → Deploy from GitHub repo).
2. Nixpacks otomatik olarak `npm run build` ve `npm start` çalıştırır
   (`start` script'i `vite preview` ile `dist` klasörünü `$PORT` üzerinden servis eder).
3. Ayar gerekmez.

## Teknolojiler

- [Vite](https://vitejs.dev) + [React](https://react.dev) + TypeScript
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF metin çıkarma (tarayıcıda)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — Word (.docx) metin çıkarma (tarayıcıda)
