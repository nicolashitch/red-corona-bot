const { google } = require("googleapis");

const ADMIN_ID = "8291674623";

function nowDate() {
  return new Date().toLocaleString("es-AR");
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

async function sendTelegram(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function answerCallback(callbackId, text = "Listo ✅") {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text })
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
        to,
        type: "text",
        text: { body: text }
      })
    }
  );

  const data = await response.json();
  console.log("Respuesta WhatsApp desde Telegram:", JSON.stringify(data, null, 2));
  return data;
}

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function findUserRowById(userId) {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:X"
  });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(userId)) {
      return { rowNumber: i + 1, row: rows[i] };
    }
  }

  return null;
}

async function updateUserStatus(userId, status, extras = {}) {
  const sheets = getSheetsClient();
  const found = await findUserRowById(userId);

  if (!found) {
    await sendTelegram(ADMIN_ID, `⚠️ No encontré el usuario <code>${userId}</code> en Sheets.`);
    return false;
  }

  const row = found.row;

  const totalCargadoActual = toNumber(row[14]);
  const totalRetiradoActual = toNumber(row[15]);

  const cargaNueva = toNumber(extras.sumarCarga);
  const retiroNuevo = toNumber(extras.sumarRetiro);

  const totalCargado = cargaNueva ? totalCargadoActual + cargaNueva : toNumber(row[14]);
  const totalRetirado = retiroNuevo ? totalRetiradoActual + retiroNuevo : toNumber(row[15]);
  const saldoNeto = totalCargado - totalRetirado;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `J${found.rowNumber}:X${found.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        status || row[9] || "",
        extras.primeraCarga ?? row[10] ?? "",
        extras.fechaCarga ?? row[11] ?? "",
        extras.ultimoRetiro ?? row[12] ?? "",
        extras.fechaRetiro ?? row[13] ?? "",
        totalCargado,
        totalRetirado,
        saldoNeto,
        nowDate(),
        extras.administrador ?? row[18] ?? "",
        extras.vip ?? row[19] ?? "NO",
        extras.canalOficial ?? row[20] ?? "NO",
        extras.observaciones ?? row[21] ?? "",
        extras.fechaBloqueo ?? row[22] ?? "",
        extras.motivoBloqueo ?? row[23] ?? ""
      ]]
    }
  });

  return true;
}

function actionButtons(userId) {
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

async function handleCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0];

  if (command === "/start" || command === "/menu") {
    await sendTelegram(ADMIN_ID, `👑 <b>Panel ADM Red Corona Bett</b>

Comandos:

<code>/enviarusuario ID USUARIO CONTRASEÑA LINK</code>
<code>/cargo ID MONTO</code>
<code>/retiroconfirmado ID</code>
<code>/responder ID MENSAJE</code>`);
    return;
  }

  if (command === "/enviarusuario") {
    const [, userId, usuario, password, ...linkParts] = parts;
    const link = linkParts.join(" ");

    if (!userId || !usuario || !password || !link) {
      await sendTelegram(ADMIN_ID, "Uso correcto:\n<code>/enviarusuario ID USUARIO CONTRASEÑA LINK</code>");
      return;
    }

    await updateUserStatus(userId, "Usuario enviado", { observaciones: `Usuario: ${usuario}` });

    await sendWhatsApp(userId, `✅ Tu acceso ya está listo

👤 Usuario: ${usuario}
🔐 Contraseña: ${password}
🔗 Link: ${link}

Cuando realices tu carga, enviá el comprobante por este mismo chat.`);

    await sendTelegram(ADMIN_ID, `✅ Usuario enviado correctamente a <code>${userId}</code>.`);
    return;
  }

  if (command === "/cargo") {
    const [, userId, monto] = parts;

    if (!userId || !monto) {
      await sendTelegram(ADMIN_ID, "Uso correcto:\n<code>/cargo ID MONTO</code>");
      return;
    }

    await updateUserStatus(userId, "Carga confirmada", {
      sumarCarga: monto,
      primeraCarga: monto,
      fechaCarga: nowDate()
    });

    await sendWhatsApp(userId, `✅ Carga confirmada.

Tu acreditación ya fue revisada y actualizada correctamente.`);

    await sendTelegram(ADMIN_ID, `✅ Carga confirmada para <code>${userId}</code> por <b>${monto}</b>.`);
    return;
  }

  if (command === "/retiroconfirmado") {
    const [, userId] = parts;

    if (!userId) {
      await sendTelegram(ADMIN_ID, "Uso correcto:\n<code>/retiroconfirmado ID</code>");
      return;
    }

    await updateUserStatus(userId, "Retiro confirmado", {
      fechaRetiro: nowDate()
    });

    await sendWhatsApp(userId, `✅ Retiro confirmado.

La operación fue revisada correctamente.`);

    await sendTelegram(ADMIN_ID, `✅ Retiro confirmado para <code>${userId}</code>.`);
    return;
  }

  if (command === "/responder") {
    const [, userId, ...msgParts] = parts;
    const mensaje = msgParts.join(" ");

    if (!userId || !mensaje) {
      await sendTelegram(ADMIN_ID, "Uso correcto:\n<code>/responder ID MENSAJE</code>");
      return;
    }

    await sendWhatsApp(userId, mensaje);
    await sendTelegram(ADMIN_ID, `💬 Mensaje enviado a <code>${userId}</code>.`);
    return;
  }

  await sendTelegram(ADMIN_ID, "No entendí el comando. Usá /menu");
}

async function handleCallback(callbackQuery) {
  const data = callbackQuery.data || "";
  const callbackId = callbackQuery.id;
  const [action, userId] = data.split(":");

  await answerCallback(callbackId);

  if (!userId) {
    await sendTelegram(ADMIN_ID, "⚠️ Botón inválido.");
    return;
  }

  if (action === "confirmar_carga") {
    await sendTelegram(ADMIN_ID, `✅ Para confirmar carga usá:\n<code>/cargo ${userId} MONTO</code>`);
    return;
  }

  if (action === "enviar_usuario") {
    await sendTelegram(ADMIN_ID, `👤 Para enviar usuario usá:\n<code>/enviarusuario ${userId} USUARIO CONTRASEÑA LINK</code>`);
    return;
  }

  if (action === "confirmar_retiro") {
    await sendTelegram(ADMIN_ID, `💸 Para confirmar retiro usá:\n<code>/retiroconfirmado ${userId}</code>`);
    return;
  }

  if (action === "rechazar") {
    await updateUserStatus(userId, "Rechazado");
    await sendWhatsApp(userId, "❌ Tu solicitud fue revisada y no pudo ser aprobada. Escribí nuevamente si necesitás ayuda.");
    await sendTelegram(ADMIN_ID, `❌ Solicitud rechazada para <code>${userId}</code>.`);
    return;
  }

  if (action === "ver_perfil") {
    const found = await findUserRowById(userId);

    if (!found) {
      await sendTelegram(ADMIN_ID, `⚠️ No encontré el usuario <code>${userId}</code> en Sheets.`);
      return;
    }

    const r = found.row;

    await sendTelegram(ADMIN_ID, `📋 <b>PERFIL DEL USUARIO</b>

ID: <code>${userId}</code>
Origen: ${r[1] || ""}
Nombre WhatsApp: ${r[4] || ""}
Nombre: ${r[5] || ""}
Plataforma: ${r[6] || ""}
Teléfono: ${r[7] || ""}
País: ${r[8] || ""}
Estado: ${r[9] || ""}

Total cargado: ${r[14] || "0"}
Total retirado: ${r[15] || "0"}
Saldo neto: ${r[16] || "0"}

VIP: ${r[19] || "NO"}
Canal: ${r[20] || "NO"}`);
    return;
  }

  if (action === "responder") {
    await sendTelegram(ADMIN_ID, `💬 Para responder usá:\n<code>/responder ${userId} MENSAJE</code>`);
    return;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const body = req.body;
    console.log("Webhook Telegram recibido:", JSON.stringify(body, null, 2));

    if (body.callback_query) {
      await handleCallback(body.callback_query);
      return res.status(200).send("OK");
    }

    const message = body.message;
    if (!message) return res.status(200).send("OK");

    const chatId = String(message.chat.id);
    const text = message.text || "";

    if (chatId !== ADMIN_ID) {
      await sendTelegram(chatId, "No autorizado.");
      return res.status(200).send("OK");
    }

    if (text) {
      await handleCommand(text);
      return res.status(200).send("OK");
    }

    if (message.photo || message.document) {
      await sendTelegram(ADMIN_ID, "📎 Archivo recibido en Telegram.");
      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error general Telegram webhook:", error);
    return res.status(200).send("OK");
  }
};
