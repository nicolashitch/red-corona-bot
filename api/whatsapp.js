module.exports = async function handler(req, res) {
  try {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
    const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }

      return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
      const body = req.body;
      console.log("Webhook WhatsApp recibido:", JSON.stringify(body, null, 2));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message) {
        return res.status(200).send("EVENT_RECEIVED");
      }

      const from = message.from;
      const text = message.text?.body?.trim() || "";

      let respuesta = "";

      if (text === "1") {
        respuesta =
`✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

💳 DATOS PARA CARGAR

🏦 Alias:
redcoronabet7

🔢 CVU:
000177500393009854128

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego de transferir, enviá el comprobante por este mismo chat.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`;
      } else {
        respuesta =
`👋 Bienvenido a Red Corona Bett.

Elegí una opción:

1️⃣ Solicitar acceso
2️⃣ Canal oficial
3️⃣ Hablar con un administrador`;
      }

      await enviarWhatsApp(from, respuesta, TOKEN, PHONE_NUMBER_ID);

      return res.status(200).send("EVENT_RECEIVED");
    }

    return res.status(405).send("Method Not Allowed");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(500).send("Internal Server Error");
  }
};

async function enviarWhatsApp(to, text, token, phoneNumberId) {
  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );

  const data = await response.json();
  console.log("Respuesta enviada por WhatsApp:", data);
}
