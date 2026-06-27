import { createHash } from "crypto";

const ADMIN_ID = "8291674623";
const sessions = {};

function hashValue(value) {
  return createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex");
}

async function sendTelegram(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (keyboard) body.reply_markup = keyboard;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function sendWhatsApp(to, text) {
  const response = await fetch(
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to),
        type: "text",
        text: { body: text }
      })
    }
  );

  const data = await response.json();
  console.log("WhatsApp Response:", JSON.stringify(data, null, 2));
  return data;
}

async function sendMetaEvent(eventName, userId, customData = {}) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) {
      console.log("Meta CAPI omitido: faltan variables.");
      return;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          user_data: {
            external_id: [hashValue(userId)]
          },
          custom_data: customData
        }
      ]
    };

    if (process.env.META_TEST_EVENT_CODE) {
      payload.test_event_code = process.env.META_TEST_EVENT_CODE;
    }

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();
    console.log("Meta Event:", eventName, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Meta Event Error:", error);
  }
}

function mainMenu() {
  return `👑 Bienvenido a Red Corona Bett

Elegí una opción:

1️⃣ Crear Usuario
2️⃣ Canal Oficial
3️⃣ Hablar con un administrador`;
}

function platformMenu() {
  return `🎮 Elegí una plataforma:

1️⃣ Bet Space
2️⃣ Ganamosnet Org
3️⃣ Zeus`;
}

function getPlatform(text) {
  if (text === "1") return "Bet Space";
  if (text === "2") return "Ganamosnet Org";
  if (text === "3") return "Zeus";
  return null;
}

function adminButtons(userId) {
  return {
    inline_keyboard: [
      [
        {
          text: "📩 Enviar usuario",
          callback_data: `enviar_usuario_${userId}`
        }
      ],
      [
        {
          text: "✅ Confirmar carga",
          callback_data: `confirmar_carga_${userId}`
        }
      ]
    ]
  };
}

async function finishLead(from, contactName, session) {
  await sendMetaEvent("Lead", from, {
    source: "whatsapp",
    nombre: session.name,
    platform: session.platform
  });

  await sendTelegram(
    ADMIN_ID,
    `🚨 <b>NUEVO LEAD WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Nombre: ${session.name}
🎮 Plataforma: ${session.platform}

WhatsApp:
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

Lead enviado a Meta ✅`,
    adminButtons(from)
  );

  await sendWhatsApp(
    from,
    `✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

⏳ Te contactaremos a la brevedad.`
  );

  delete sessions[from];
}

async function handleSession(from, contactName, text) {
  const session = sessions[from];

  if (!session) return false;

  if (session.step === "name") {
    session.name = text;
    session.step = "platform";

    await sendWhatsApp(from, platformMenu());
    return true;
  }

  if (session.step === "platform") {
    const platform = getPlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una opción válida:\n\n" + platformMenu());
      return true;
    }

    session.platform = platform;
    session.step = "completed";

    await finishLead(from, contactName, session);
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  try {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }

      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const body = req.body;
    console.log("Webhook WhatsApp recibido:", JSON.stringify(body, null, 2));

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.status(200).send("EVENT_RECEIVED");
    }

    const from = message.from;
    const contactName = value?.contacts?.[0]?.profile?.name || "Sin nombre";
    const text = message.text?.body?.trim() || "";

    if (!text) {
      return res.status(200).send("EVENT_RECEIVED");
    }

    const lower = text.toLowerCase();

    if (lower === "hola" || lower === "menu" || lower === "menú" || text === "0") {
      delete sessions[from];
      await sendWhatsApp(from, mainMenu());
      return res.status(200).send("EVENT_RECEIVED");
    }

    // IMPORTANTE:
    // Primero revisamos si el usuario está dentro de un flujo.
    // Esto evita que "2" se confunda con Canal Oficial cuando está eligiendo plataforma.
    if (sessions[from]) {
      await handleSession(from, contactName, text);
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "1") {
      sessions[from] = { step: "name" };

      await sendWhatsApp(
        from,
        "👤 Perfecto.\n\n¿Cuál es tu nombre?"
      );

      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "2") {
      await sendWhatsApp(
        from,
        "📢 Canal Oficial:\n\nhttps://t.me/redcoronabet"
      );

      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "3") {
      await sendWhatsApp(
        from,
        "👨‍💼 Administrador:\n\nhttps://t.me/Eliamcorona"
      );

      return res.status(200).send("EVENT_RECEIVED");
    }

    await sendWhatsApp(from, mainMenu());
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
}
