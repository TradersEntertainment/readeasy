import { useEffect, useState } from "react";
import { AD_REWARD_SECONDS } from "../lib/premium";

interface Props {
  onReward: () => void; // reklam tamamlandı → ek süre ver
  onExit: () => void; // ana sayfaya dön
}

// Ödüllü reklam yer tutucusu: gerçek ağ (iOS'ta AdMob rewarded,
// web'de AdSense) bağlanana kadar geri sayımlı bir demo alan gösterir.
// Entegrasyon noktası: AdSlot bileşenini reklam SDK çağrısıyla değiştirin.
const AD_SECONDS = 5;

export default function Paywall({ onReward, onExit }: Props) {
  const [mode, setMode] = useState<"offer" | "ad">("offer");
  const [countdown, setCountdown] = useState(AD_SECONDS);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "ad" || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [mode, countdown]);

  const goPremium = () => {
    const url = import.meta.env.VITE_PREMIUM_URL;
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      setNote(
        "Ödeme entegrasyonu yakında: App Store sürümünde Apple içi satın alma, " +
          "web'de Stripe bağlanacak.",
      );
    }
  };

  return (
    <div className="paywall">
      {mode === "offer" ? (
        <div className="paywall__card">
          <span className="paywall__emoji">⏳</span>
          <h2>Bugünlük ücretsiz süren doldu</h2>
          <p>
            Kısa bir reklam izleyerek {Math.round(AD_REWARD_SECONDS / 60)} dakika
            daha kazanabilir ya da Premium ile sınırsız ve reklamsız
            okuyabilirsin.
          </p>
          <button className="btn btn--primary" onClick={() => setMode("ad")}>
            🎬 Reklam izle · +{Math.round(AD_REWARD_SECONDS / 60)} dk
          </button>
          <button className="btn" onClick={goPremium}>
            ⭐ Premium'a geç — sınırsız &amp; reklamsız
          </button>
          <button className="btn btn--ghost" onClick={onExit}>
            Ana sayfaya dön
          </button>
          {note && <p className="paywall__note">{note}</p>}
        </div>
      ) : (
        <div className="paywall__card">
          <div className="paywall__adslot">
            <span className="paywall__adlabel">REKLAM</span>
            <p>
              Demo reklam alanı — canlıda burada AdMob / AdSense ödüllü reklamı
              oynar.
            </p>
            {countdown > 0 && <span className="paywall__count">{countdown}</span>}
          </div>
          <button
            className="btn btn--primary"
            disabled={countdown > 0}
            onClick={onReward}
          >
            {countdown > 0
              ? `Devam etmek için bekle (${countdown})`
              : "✓ Devam et — süre eklendi"}
          </button>
        </div>
      )}
    </div>
  );
}
