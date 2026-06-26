const { google } = require("googleapis");
const { createHash } = require("crypto");

const ADMIN_ID = "8291674623";

function nowDate() {
  return new Date().toLocaleString("es-AR");
}

function hashValue(value) {
  return createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex");
}

function toNumber(value) {
  const clean = String(value || "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
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

async function sendTelegram(chatId, text, replyMarkup = null) {
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    };

    if (replyMarkup) body.reply_markup = replyMarkup;

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();
    console.log("Telegram Status:", response.status);
    console.log("Respuesta Telegram:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error enviando Telegram:", error);
    return null;
  }
}

async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null) {
  try {
    const body = {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML"
    };

    if (replyMarkup) body.reply_markup = replyMarkup;

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();
    console.log("Telegram Photo:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error enviando foto a Telegram:", error);
    return null;
  }
}

async function sendWhatsApp(to, text) {
  try {
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
          to,
          type: "text",
          text: { body: text }
        })
      }
    );

    const data = await response.json();
    console.log("WhatsApp Status:", response.status);
    console.log("Respuesta WhatsApp:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error enviando WhatsApp:", error);
    return null;
  }
}

async function sendMetaEvent(eventName, whatsappId, customData = {}) {
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
          event_id: `${eventName}_${whatsappId}_${Date.now()}`,
          user_data: {
            external_id: [hashValue(whatsappId)]
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
    console.log("Evento Meta:", eventName, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error Meta CAPI:", error);
  }
}

function adminButtons(userId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirmar carga", callback_data: `confirmar_carga:${userId}` },
        { text: "👤 Enviar usuario", callback_data: `enviar_usuario:${userId}` }
      ],
      [
        { text: "💸 Confirmar retiro", callback_data: `confirmar_retiro:${userId}` },
        { text: "❌ Rechazar", callback_data: `rechazar:${userId}` }
      ],
      [
        { text: "📋 Ver perfil", callback_data: `ver_perfil:${userId}` },
        { text: "💬 Responder", callback_data: `responder:${userId}` }
      ]
    ]
  };
}

async function getRows() {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:X"
  });

  return response.data.values || [];
}

async function findUserRowById(userId) {
  const rows = await getRows();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || "").trim() === String(userId).trim()) {
      return { rowNumber: i + 1, row: rows[i] };
    }
  }

  return null;
}

function normalizeRow(row = []) {
  const r = Array.from({ length: 24 }, (_, i) => row[i] || "");
  return r;
}

async function saveFullRow(rowNumber, row) {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `A${rowNumber}:X${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [normalizeRow(row)]
    }
  });
}

async function createUserRow({ whatsappId, nombreWhatsapp }) {
  const sheets = getSheetsClient();

  const newRow = [
    nowDate(),
    "🟢 WHATSAPP",
    whatsappId,
    "",
    nombreWhatsapp || "",
    "",
    "",
    "",
    "",
    "MENU",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    nowDate(),
    "",
    "NO",
    "NO",
    "",
    "",
    ""
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:X",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [newRow] }
  });

  return await findUserRowById(whatsappId);
}

async function getOrCreateUser(whatsappId, nombreWhatsapp) {
  let found = await findUserRowById(whatsappId);
  if (found) return found;
  return await createUserRow({ whatsappId, nombreWhatsapp });
}

async function updateUser(userId, updates = {}) {
  const found = await getOrCreateUser(userId, updates.nombreWhatsapp || "");
  if (!found) return false;

  const row = normalizeRow(found.row);

  if (updates.origen !== undefined) row[1] = updates.origen;
  if (updates.username !== undefined) row[3] = updates.username;
  if (updates.nombreWhatsapp !== undefined) row[4] = updates.nombreWhatsapp;
  if (updates.nombre !== undefined) row[5] = updates.nombre;
  if (updates.plataforma !== undefined) row[6] = updates.plataforma;
  if (updates.telefono !== undefined) row[7] = updates.telefono;
  if (updates.pais !== undefined) row[8] = updates.pais;
  if (updates.estado !== undefined) row[9] = updates.estado;
  if (updates.primeraCarga !== undefined) row[10] = updates.primeraCarga;
  if (updates.fechaCarga !== undefined) row[11] = updates.fechaCarga;
  if (updates.ultimoRetiro !== undefined) row[12] = updates.ultimoRetiro;
  if (updates.fechaRetiro !== undefined) row[13] = updates.fechaRetiro;

  if (updates.sumarCarga !== undefined) {
    row[14] = toNumber(row[14]) + toNumber(updates.sumarCarga);
  }

  if (updates.sumarRetiro !== undefined) {
    row[15] = toNumber(row[15]) + toNumber(updates.sumarRetiro);
  }

  row[16] = toNumber(row[14]) - toNumber(row[15]);
  row[17] = nowDate();

  if (updates.administrador !== undefined) row[18] = updates.administrador;
  if (updates.vip !== undefined) row[19] = updates.vip;
  if (updates.canalOficial !== undefined) row[20] = updates.canalOficial;
  if (updates.observaciones !== undefined) row[21] = updates
