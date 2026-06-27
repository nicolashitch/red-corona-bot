import { google } from "googleapis";
import { createHash } from "crypto";

const ADMIN_ID = "8291674623";

function nowDate() {
  return new Date().toLocaleString("es-AR");
}

function hashValue(value) {
  return createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex");
}

function getCredentials() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return credentials;
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function sendTelegram(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
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

async function sendMetaLead(whatsappId, platform) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) {
      console.log("Meta Lead omitido: faltan variables.");
      return;
    }

    const payload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          event_id: `Lead_${whatsappId}_${Date.now()}`,
          user_data: {
            external_id: [hashValue(whatsappId)]
          },
          custom_data: {
            source: "whatsapp",
            platform
          }
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
    console.log("Meta Lead:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error Meta Lead:", error);
  }
}

function mainMenuText() {
  return `👑 Bienvenido a Red Corona Bett

Elegí una opción respondiendo con el número:

1️⃣ Crear Usuario
2️⃣ Canal Oficial
3️⃣ Hablar con un administrador

0️⃣ Menú`;
}

function platformMenuText() {
  return `🎮 Elegí una plataforma respondiendo con el número:

1️⃣ Bet Space
2️⃣ Ganamosnet Org
3️⃣ Zeus

0️⃣ Menú`;
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
        { text: "📩 Enviar usuario", callback_data: `enviar_usuario_${userId}` }
      ],
      [
        { text: "✅ Confirmar carga", callback_data: `confirmar_carga_${userId}` }
      ]
    ]
  };
}

async function getRows() {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:N"
  });

  return response.data.values || [];
}

async function findUserRowById(userId) {
  const rows = await getRows();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || "").trim() === String(userId).trim()) {
      return {
        rowNumber: i + 1,
        row: rows[i]
      };
    }
  }

  return null;
}

async function createWhatsAppUser(whatsappId, contactName) {
  const sheets = getSheetsClient();

  const newRow = [
    nowDate(),
    "🟢 WHATSAPP",
    whatsappId,
    "",
    contactName || "Sin nombre",
    "",
    "",
    "",
    "",
    "MENU",
    "",
    "",
    "",
    ""
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:N",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [newRow]
    }
  });

  return await findUserRowById(whatsappId);
}

async function getOrCreateUser(whatsappId, contactName) {
  const found = await findUserRowById(whatsappId);
  if (found) return found;

  return await createWhatsAppUser(whatsappId, contactName);
}

function normalizeRow(row = []) {
  return Array.from({ length: 14 }, (_, i) => row[i] || "");
}

async function saveRow(rowNumber, row) {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `A${rowNumber}:N${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [normalizeRow(row)]
    }
  });
}

async function updateUser(whatsappId, updates = {}) {
  const found = await getOrCreateUser(whatsappId, updates.contactName || "");
  const row = normalizeRow(found.row);

  if (updates.fecha !== undefined) row[0] = updates.fecha;
  if (updates.origen !== undefined) row[1] = updates.origen;
  if (updates.id !== undefined) row[2] = updates.id;
  if (updates.username !== undefined) row[3] = updates.username;
  if (updates.nombreWhatsapp !== undefined) row[4] = updates.nombreWhatsapp;
  if (updates.nombre !== undefined) row[5] = updates.nombre;
  if (updates.plataforma !== undefined) row[6] = updates.plataforma;
  if (updates.telefono !== undefined) row[7] = updates.telefono;
  if (updates.pais !== undefined) row[8] = updates.pais;
  if (updates.estado !== undefined) row[9] = updates.estado;
  if (updates.primeraCarga !== undefined) row[10] = updates.primeraCarga;
  if (updates.fechaCarga !== undefined) row[11] = updates.fechaCarga;
  if (updates.primerRetiro !== undefined) row[12] = updates.primerRetiro;
  if (updates.fechaRetiro !== undefined) row[13] = updates.fechaRetiro;

  await saveRow(found.rowNumber, row);
  return row;
}

async function finishLead(whatsappId, contactName, row, platform) {
  await updateUser(whatsappId, {
    estado: "Registrado",
    plataforma: platform,
    nombreWhatsapp: contactName
  });

  await sendMetaLead(whatsappId, platform);

  await sendTelegram(
    ADMIN_ID,
    `🚨 <b>NUEVO LEAD WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Nombre: ${row[5] || contactName}
🎮 Plataforma: ${platform}

WhatsApp:
ID: <code>${whatsappId}</code>
Nombre WhatsApp: ${contactName}

✅ Lead enviado a Meta.`,
    adminButtons(whatsappId)
  );

  await sendWhatsApp(
    whatsappId,
    `✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

⏳ Te contactaremos a la brevedad.`
  );
}

async function handleText(from, contactName, text) {
  const found = await getOrCreateUser(from, contactName);
  const row = normalizeRow(found.row);
  const estado = String(row[9] || "MENU").trim();
  const lower = String(text || "").trim().toLowerCase();

  console.log("Estado actual WhatsApp:", {
    from,
    contactName,
    text,
    estado
  });

  if (lower === "hola" || lower === "menu" || lower === "menú" || text === "0") {
    await updateUser(from, {
      estado: "MENU",
      nombreWhatsapp: contactName,
      origen: "🟢 WHATSAPP"
    });

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (estado === "REG_NOMBRE") {
    await updateUser(from, {
      estado: "REG_PLATAFORMA",
      nombre: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformMenuText());
    return;
  }

  if (estado === "REG_PLATAFORMA") {
    const platform = getPlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Opción inválida.\n\n" + platformMenuText());
      return;
    }

    const updatedRow = await updateUser(from, {
      estado: "Registrado",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await finishLead(from, contactName, updatedRow, platform);
    return;
  }

  if (estado === "MENU" || estado === "" || estado === "Registrado" || estado === "Usuario enviado" || estado === "Cargó") {
    if (text === "1") {
      await updateUser(from, {
        estado: "REG_NOMBRE",
        nombreWhatsapp: contactName,
        origen: "🟢 WHATSAPP"
      });

      await sendWhatsApp(from, "👤 Perfecto.\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await sendWhatsApp(from, "📢 Canal Oficial:\n\nhttps://t.me/redcoronabet");
      return;
    }

    if (text === "3") {
      await sendTelegram(
        ADMIN_ID,
        `👨‍💼 <b>CLIENTE PIDE ADM WHATSAPP</b>

WhatsApp:
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}`,
        adminButtons(from)
      );

      await sendWhatsApp(from, "👨‍💼 Un administrador fue notificado.\n\nTambién podés escribir por Telegram:\nhttps://t.me/Eliamcorona");
      return;
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  await sendWhatsApp(from, mainMenuText());
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
      await sendWhatsApp(from, mainMenuText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    await handleText(from, contactName, text);

    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
}
