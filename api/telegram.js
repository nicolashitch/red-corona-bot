export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Red Corona Bot Online");
  }

  const update = req.body;

  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === "/start") {
      await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: "👑 Bienvenido a Red Corona Bett\n\nSelecciona una opción:",
            reply_markup: {
              keyboard: [
                ["🎮 Crear Usuario"],
                ["👨‍💼 Hablar con un ADM"],
                ["📢 Canal Oficial"],
                ["🎁 Beneficios"]
              ],
              resize_keyboard: true
            }
          })
        }
      );
    }
  }

  return res.status(200).json({ ok: true });
}
