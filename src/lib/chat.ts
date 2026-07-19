// Belge hakkında AI sohbeti: anahtar gerektirmeyen, herkese açık
// text.pollinations.ai servisi kullanılır (Hikayeleştir ile aynı sağlayıcı).
// Kullanıcının sorusuyla birlikte belgeden bir bölüm bu servise gönderilir;
// ileride premium için aynı arayüzle ücretli bir modele (Claude/GPT)
// backend proxy üzerinden geçilebilir.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_REPLY_CHARS = 4000;

export async function chatAboutDoc(
  docTitle: string,
  context: string,
  messages: ChatMessage[],
): Promise<string> {
  const system =
    "Sen ReadEasy okuma uygulamasının içinde, kullanıcının o an okuduğu belge " +
    "hakkında sohbet eden samimi, yardımsever bir asistansın. Kısa ve sohbet " +
    "havasında yanıtlar ver (genelde birkaç cümle). Kullanıcı hangi dilde " +
    "yazarsa o dilde yanıtla; varsayılan Türkçe. Yorum yaparken belgeye " +
    `dayan, uydurma. Belgenin başlığı: "${docTitle}". Belgeden bölüm:\n\n` +
    context;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text) throw new Error("boş yanıt");
    return text.slice(0, MAX_REPLY_CHARS);
  } finally {
    clearTimeout(timer);
  }
}
