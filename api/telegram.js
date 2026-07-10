import { google } from "googleapis";
import { createHash } from "crypto";

const ADMIN_ID = "8291674623";
const sessions = {};

function getSourceLabel(source) {
  if (source === "meta") return "🟢 META ADS";
  if (source === "whatsapp") return "🟢 WHATSAPP";
  return "⚪ Orgánico / Directo";
}

function getStartSource(text) {
  const parts = text.split(" ");
  return parts[1] || "direct";
}

function nowDate() {
  return new Date().toLocaleString("es-AR");
}

function hashValue(value) {
  return createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex");
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isWhatsAppId(userId) {
  return /^\d{10,15}$/.test(String(userId || ""));
}

function adminButtons(userId) {
  return {
    inline_keyboard: [
      [
        { text: "📩 Enviar usuario", callback_data: `enviar_usuario_${userId}` },
        { text: "✅ Confirmar carga", callback_data: `confirmar_carga_${userId}` }
      ],
      [
        { text: "💸 Retiro realizado", callback_data: `retiro_realizado_${userId}` },
        { text: "✅ Pago enviado", callback_data: `pago_enviado_${userId}` }
      ],
      [
        { text: "✍️ Mensaje libre", callback_data: `mensaje_libre_${userId}` },
        { text: "❌ Rechazar", callback_data: `rechazar_${userId}` }
      ]
    ]
  };
}

async function sendMetaEvent(eventName, userId, customData = {}) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) {
      console.log("Meta omitido: faltan META_PIXEL_ID o META_ACCESS_TOKEN");
      return;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          event_id: `${eventName}_${userId}_${Date.now()}`,
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
    console.log("Evento Meta:", eventName, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error Meta CAPI:", error);
  }
}

async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
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
        text: { body: text.replace(/<[^>]*>/g, "") }
      })
    }
  );

  const data = await response.json();
  console.log("WhatsApp desde Telegram:", JSON.stringify(data, null, 2));
  return data;
}

async function sendToUser(userId, text, keyboard = null) {
  if (isWhatsAppId(userId)) {
    return await sendWhatsApp(userId, text);
  }
  return await sendMessage(userId, text, keyboard);
}

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function saveUserToSheet(data) {
  try {
    const sheets = getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "A:N",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          nowDate(),
          data.origen,
          data.telegramId,
          data.username,
          data.nombreTelegram,
          data.nombre,
          data.plataforma,
          data.telefono,
          data.pais,
          data.estado,
          "",
          "",
          "",
          ""
        ]]
      }
    });
  } catch (error) {
    console.error("Error guardando en Google Sheets:", error);
    await sendMessage(ADMIN_ID, "⚠️ Error guardando usuario en Google Sheets. El bot sigue funcionando.");
  }
}

async function findUserRowByTelegramId(telegramId) {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:N"
  });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(telegramId)) {
      return { rowNumber: i + 1, row: rows[i] };
    }
  }

  return null;
}

async function updateUserStatus(telegramId, status, extras = {}) {
  try {
    const sheets = getSheetsClient();
    const found = await findUserRowByTelegramId(telegramId);

    if (!found) {
      await sendMessage(ADMIN_ID, `⚠️ No encontré el usuario ${telegramId} en Google Sheets.`);
      return false;
    }

    const row = found.row;

    const estado = status || row[9] || "";
    const primeraCarga = extras.primeraCarga ?? row[10] ?? "";
    const fechaCarga = extras.fechaCarga ?? row[11] ?? "";
    const primerRetiro = extras.primerRetiro ?? row[12] ?? "";
    const fechaRetiro = extras.fechaRetiro ?? row[13] ?? "";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `J${found.rowNumber}:N${found.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[estado, primeraCarga, fechaCarga, primerRetiro, fechaRetiro]]
      }
    });

    return true;
  } catch (error) {
    console.error("Error actualizando estado en Google Sheets:", error);
    await sendMessage(ADMIN_ID, "⚠️ Error actualizando estado en Google Sheets.");
    return false;
  }
}

function mainMenu() {
  return {
    keyboard: [
      ["🎮 Crear Usuario"],
      ["💳 Cargar"],
      ["🥳💸 Gané y quiero retirar"],
      ["👨‍💼 Hablar con un ADM"],
      ["📢 Canal Oficial"],
      ["🎁 Beneficios"]
    ],
    resize_keyboard: true
  };
}

function platformMenu() {
  return {
    keyboard: [
      ["💫 Bet Space"],
      ["🌟 Ganamosnet Org"],
      ["⚡️ Zeus (multi)"],
      ["⬅️ Volver"]
    ],
    resize_keyboard: true
  };
}

function afterRegisterMenu() {
  return {
    keyboard: [
      ["📢 Canal Oficial"],
      ["🎁 Reclamar Bonos"],
      ["⭐ Acceso VIP"],
      ["💳 Cargar"],
      ["🥳💸 Gané y quiero retirar"],
      ["⬅️ Volver"]
    ],
    resize_keyboard: true
  };
}

function bonusesMenu() {
  return {
    keyboard: [
      ["🎉 Bono de Bienvenida"],
      ["🤝 Recomendación"],
      ["💎 Fidelidad"],
      ["⬅️ Volver"]
    ],
    resize_keyboard: true
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Red Corona Bot Online");
  }

  const update = req.body;

  if (update.callback_query) {
    const data = update.callback_query.data;
    const adminChatId = update.callback_query.message.chat.id;

    if (data.startsWith("mensaje_libre_")) {
      const userId = data.replace("mensaje_libre_", "");

      sessions[ADMIN_ID] = {
        step: "admin_free_message",
        targetUserId: userId
      };

      await sendMessage(
        adminChatId,
        `✍️ <b>Mensaje libre activado</b>

Ahora escribí el mensaje que querés enviarle al usuario:

ID: <code>${userId}</code>

El próximo mensaje que escribas se enviará directo al usuario.`
      );

      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("rechazar_")) {
      const userId = data.replace("rechazar_", "");

      await updateUserStatus(userId, "Rechazado");

      await sendToUser(
        userId,
        `❌ Solicitud rechazada

Un administrador revisó tu solicitud y fue rechazada.

Si creés que hubo un error o querés hacer una nueva consulta, podés escribir nuevamente por este chat.`
      );

      await sendMessage(
        adminChatId,
        `❌ Solicitud rechazada.

ID: <code>${userId}</code>

El usuario fue notificado y Sheets fue actualizado.`
      );

      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("confirmar_carga_")) {
      const userId = data.replace("confirmar_carga_", "");

      await updateUserStatus(userId, "Cargó", { fechaCarga: nowDate() });

      await sendMetaEvent("Purchase", userId, {
        source: isWhatsAppId(userId) ? "whatsapp_admin_button" : "telegram_admin_button",
        status: "Cargó",
        currency: "ARS"
      });

      await sendToUser(userId, "✅ Tu carga fue confirmada.\n\nFichas cargadas correctamente.\n\nMuchas gracias.");
      await sendMessage(adminChatId, "✅ Confirmación enviada al usuario, Sheets actualizado y Purchase enviado a Meta.");
      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("enviar_usuario_")) {
      const userId = data.replace("enviar_usuario_", "");
      await sendMessage(adminChatId, `📩 Para enviar el usuario, copiá y usá este formato:\n\n/enviarusuario ${userId} USUARIO CONTRASEÑA LINK`);
      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("retiro_realizado_")) {
      const userId = data.replace("retiro_realizado_", "");
      sessions[userId] = { ...(sessions[userId] || {}), step: "withdraw_cvu" };

      await updateUserStatus(userId, "Retiro solicitado");

      await sendToUser(userId, "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar.");
      await sendMessage(adminChatId, "✅ Se solicitó CVU/CBU al usuario.");
      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("pago_enviado_")) {
      const userId = data.replace("pago_enviado_", "");

      await updateUserStatus(userId, "Retiro pagado", { fechaRetiro: nowDate() });

      await sendToUser(userId, "✅ Pago enviado.\n\nTu retiro fue acreditado correctamente.\n\nMuchas gracias.");
      await sendMessage(adminChatId, "✅ Aviso de pago enviado al usuario y estado actualizado en Sheets.");
      return res.status(200).json({ ok: true });
    }
  }

  if (!update.message) return res.status(200).json({ ok: true });

  const chatId = update.message.chat.id;
  const text = update.message.text || "";
  const username = update.message.from?.username || "Sin username";
  const firstName = update.message.from?.first_name || "";
  const lastName = update.message.from?.last_name || "";
  const currentSession = sessions[chatId] || {};
  const source = currentSession.source || "direct";
  const sourceLabel = getSourceLabel(source);

  if (String(chatId) === ADMIN_ID && sessions[ADMIN_ID]?.step === "admin_free_message") {
    const userId = sessions[ADMIN_ID].targetUserId;

    if (!text.trim()) {
      await sendMessage(ADMIN_ID, "⚠️ Tenés que escribir un mensaje de texto para enviar.");
      return res.status(200).json({ ok: true });
    }

    await sendToUser(userId, text);
    await sendMessage(ADMIN_ID, `✅ Mensaje libre enviado correctamente.

ID: <code>${userId}</code>`);
    sessions[ADMIN_ID] = {};
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/mensaje") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 3) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/mensaje ID TEXTO DEL MENSAJE");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    const message = parts.slice(2).join(" ");

    await sendToUser(userId, message);
    await sendMessage(ADMIN_ID, `✅ Mensaje enviado correctamente.

ID: <code>${userId}</code>`);
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/rechazar") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/rechazar ID");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];

    await updateUserStatus(userId, "Rechazado");

    await sendToUser(
      userId,
      `❌ Solicitud rechazada

Un administrador revisó tu solicitud y fue rechazada.

Si creés que hubo un error o querés hacer una nueva consulta, podés escribir nuevamente por este chat.`
    );

    await sendMessage(ADMIN_ID, `❌ Solicitud rechazada y usuario notificado.

ID: <code>${userId}</code>`);
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/enviarusuario") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 5) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/enviarusuario ID USUARIO CONTRASEÑA LINK");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    const user = parts[2];
    const pass = parts[3];
    const link = parts.slice(4).join(" ");

    await updateUserStatus(userId, "Usuario enviado");

    await sendMetaEvent("CompleteRegistration", userId, {
      source: isWhatsAppId(userId) ? "whatsapp_admin" : "telegram_admin",
      status: "Usuario enviado"
    });

    await sendToUser(userId, `✅ Tu acceso ya está listo

👤 Usuario: ${user}
🔐 Contraseña: ${pass}
🔗 Link: ${link}

Cuando realices tu carga, enviá el comprobante por este mismo chat.`);

    await sendMessage(ADMIN_ID, "✅ Usuario enviado correctamente, Sheets actualizado y CompleteRegistration enviado a Meta.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/cargo") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/cargo ID MONTO");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    const amount = parts.slice(2).join(" ") || "";

    await updateUserStatus(userId, "Cargó", {
      primeraCarga: amount,
      fechaCarga: nowDate()
    });

    await sendMetaEvent("Purchase", userId, {
      value: toNumber(amount),
      currency: "ARS",
      source: isWhatsAppId(userId) ? "whatsapp_admin_command" : "telegram_admin_command",
      status: "Cargó"
    });

    await sendToUser(userId, "✅ Tu carga fue confirmada.\n\nFichas cargadas correctamente.\n\nMuchas gracias.");
    await sendMessage(ADMIN_ID, "✅ Estado actualizado: Cargó. Purchase enviado a Meta.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/retiro ") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/retiro ID MONTO");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    const amount = parts.slice(2).join(" ") || "";

    await updateUserStatus(userId, "Retiró", {
      primerRetiro: amount,
      fechaRetiro: nowDate()
    });

    await sendMessage(ADMIN_ID, "✅ Estado actualizado: Retiró.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/retiroconfirmado") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/retiroconfirmado ID");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    sessions[userId] = { ...(sessions[userId] || {}), step: "withdraw_cvu" };

    await updateUserStatus(userId, "Retiro solicitado");

    await sendToUser(userId, "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar.");
    await sendMessage(ADMIN_ID, "✅ Se solicitó CVU/CBU al usuario.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/perdido") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/perdido ID");
      return res.status(200).json({ ok: true });
    }

    await updateUserStatus(parts[1], "Perdido");
    await sendMessage(ADMIN_ID, "✅ Estado actualizado: Perdido.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/vip") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/vip ID");
      return res.status(200).json({ ok: true });
    }

    await updateUserStatus(parts[1], "VIP");
    await sendMessage(ADMIN_ID, "✅ Estado actualizado: VIP.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/bloqueado") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/bloqueado ID");
      return res.status(200).json({ ok: true });
    }

    await updateUserStatus(parts[1], "Bloqueado");
    await sendMessage(ADMIN_ID, "✅ Estado actualizado: Bloqueado.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/comprobantepago") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");
    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/comprobantepago ID");
      return res.status(200).json({ ok: true });
    }

    sessions[ADMIN_ID] = {
      step: "waiting_payment_receipt",
      paymentUserId: parts[1]
    };

    await sendMessage(ADMIN_ID, "Perfecto ✅\n\nAhora enviá la foto o PDF del comprobante de pago.");
    return res.status(200).json({ ok: true });
  }

  if (update.message.photo || update.message.document) {
    const adminSession = sessions[ADMIN_ID];

    if (String(chatId) === ADMIN_ID && adminSession?.step === "waiting_payment_receipt") {
      const userId = adminSession.paymentUserId;

      await updateUserStatus(userId, "Retiro pagado", { fechaRetiro: nowDate() });

      await sendToUser(userId, "✅ Pago enviado.\n\nTu retiro fue acreditado correctamente.\n\nMuchas gracias.");
      await sendMessage(ADMIN_ID, "✅ Aviso de pago enviado al usuario.\n\nAhora reenviá manualmente el comprobante si querés que también vea la imagen.");

      sessions[ADMIN_ID] = {};
      return res.status(200).json({ ok: true });
    }

    await updateUserStatus(chatId, "Comprobante recibido");

    await sendMessage(
      ADMIN_ID,
      `📎 <b>COMPROBANTE RECIBIDO</b>

Origen: ${sourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`,
      adminButtons(chatId)
    );

    await sendMessage(chatId, "✅ Comprobante recibido.\n\nUn administrador lo revisará y acreditará tu carga a la brevedad.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/start") || text === "⬅️ Volver") {
    const startSource = text.startsWith("/start") ? getStartSource(text) : source;
    const startSourceLabel = getSourceLabel(startSource);

    await sendMetaEvent("BotStart", chatId, { source: startSourceLabel });

    await sendMessage(
      ADMIN_ID,
      `👀 <b>BOT START</b>

Origen: ${startSourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`,
      adminButtons(chatId)
    );

    sessions[chatId] = { source: startSource };

    await sendMessage(chatId, "👑 <b>Bienvenido a Red Corona Bett</b>\n\nSelecciona una opción:", mainMenu());
    return res.status(200).json({ ok: true });
  }

  if (text === "🎮 Crear Usuario" || text === "/registro") {
    await sendMetaEvent("RegistroIniciado", chatId, { source: sourceLabel });

    await sendMessage(
      ADMIN_ID,
      `🎮 <b>REGISTRO INICIADO</b>

Origen: ${sourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`,
      adminButtons(chatId)
    );

    sessions[chatId] = { step: "name", source };
    await sendMessage(chatId, "Perfecto ✅\n\n¿Cuál es tu nombre?");
    return res.status(200).json({ ok: true });
  }

  if (text === "💳 Cargar") {
    sessions[chatId] = { step: "load_user", source };

    await sendMetaEvent("CargaIniciada", chatId, { source: sourceLabel });

    await sendMessage(chatId, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
    return res.status(200).json({ ok: true });
  }

  if (text === "🥳💸 Gané y quiero retirar") {
    sessions[chatId] = { step: "withdraw_user", source };
    await sendMessage(chatId, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
    return res.status(200).json({ ok: true });
  }

  if (text === "👨‍💼 Hablar con un ADM" || text === "/admin") {
    await sendMessage(chatId, "Podés hablar con un administrador acá:\n\nhttps://t.me/Eliamcorona");
    return res.status(200).json({ ok: true });
  }

  if (text === "📢 Canal Oficial" || text === "/canal") {
    await sendMessage(chatId, "📢 Canal Oficial\n\nUnite desde acá:\nhttps://t.me/redcoronabet");
    return res.status(200).json({ ok: true });
  }

  if (text === "🎁 Beneficios" || text === "/beneficios" || text === "🎁 Reclamar Bonos") {
    await sendMessage(chatId, "🎁 Seleccioná el beneficio que querés consultar:", bonusesMenu());
    return res.status(200).json({ ok: true });
  }

  if (text === "🎉 Bono de Bienvenida") {
    await sendMessage(chatId, "🎉 Bono de Bienvenida\n\nUna vez que tu usuario esté habilitado podés solicitar este beneficio.", bonusesMenu());
    return res.status(200).json({ ok: true });
  }

  if (text === "🤝 Recomendación") {
    await sendMessage(chatId, "🤝 Recomendación\n\nEnviá una captura donde nos recomendaste y/o etiquetaste.\n\nPlataformas válidas:\n\n✅ Estados de WhatsApp\n✅ Facebook\n\nEtiqueta @recoronabetadm @nicolasmaximocorona\n\nY recibi tu premio 🥇 🏆 🥳", bonusesMenu());
    await sendMessage(ADMIN_ID, `🤝 <b>SOLICITUD RECOMENDACIÓN</b>\n\nOrigen: ${sourceLabel}\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`, adminButtons(chatId));
    return res.status(200).json({ ok: true });
  }

  if (text === "💎 Fidelidad") {
    await sendMessage(chatId, "💎 Fidelidad\n\nLuego de que tu recomendado realice su primera carga, ambos reciben su bono especial 🥳💸🎁💰\n\n♦️ Reclama el tuyo ahora.", bonusesMenu());
    await sendMessage(ADMIN_ID, `💎 <b>SOLICITUD FIDELIDAD</b>\n\nOrigen: ${sourceLabel}\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`, adminButtons(chatId));
    return res.status(200).json({ ok: true });
  }

  if (text === "⭐ Acceso VIP") {
    await sendMessage(ADMIN_ID, `⭐ <b>SOLICITUD VIP</b>\n\nOrigen: ${sourceLabel}\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`, adminButtons(chatId));
    await sendMessage(chatId, "⭐ <b>Acceso VIP</b>\n\nLos usuarios VIP reciben atención prioritaria, beneficios exclusivos y acceso a un canal privado.\n\nRequisito: actividad superior a $100.000.\n\nTu solicitud fue enviada a un administrador.", afterRegisterMenu());
    return res.status(200).json({ ok: true });
  }

  const session = sessions[chatId] || {};
  const sessionSourceLabel = getSourceLabel(session.source || source);

  if (session.step === "withdraw_user") {
    session.withdrawUser = text;
    session.step = "withdraw_platform";
    sessions[chatId] = session;
    await sendMessage(chatId, "Perfecto. Ahora elegí la plataforma:", platformMenu());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_platform") {
    const platforms = ["💫 Bet Space", "🌟 Ganamosnet Org", "⚡️ Zeus (multi)"];
    if (!platforms.includes(text)) {
      await sendMessage(chatId, "Elegí una plataforma usando los botones:", platformMenu());
      return res.status(200).json({ ok: true });
    }

    session.withdrawPlatform = text;
    session.step = "withdraw_amount";
    sessions[chatId] = session;
    await sendMessage(chatId, "Perfecto ✅\n\n¿Cuánto querés retirar?");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_amount") {
    session.withdrawAmount = text;
    session.step = "withdraw_waiting_admin";
    sessions[chatId] = session;

    await updateUserStatus(chatId, "Retiro solicitado", {
      primerRetiro: session.withdrawAmount,
      fechaRetiro: nowDate()
    });

    await sendMessage(
      ADMIN_ID,
      `🥳💸 <b>SOLICITUD DE RETIRO</b>

Origen: ${sessionSourceLabel}
👤 Usuario: ${session.withdrawUser}
💰 Monto: ${session.withdrawAmount}
🎮 Plataforma: ${session.withdrawPlatform}

Telegram:
ID: ${chatId}
Username: @${username}
Nombre Telegram: ${firstName} ${lastName}

Cuando retires las fichas, tocá el botón de abajo.`,
      adminButtons(chatId)
    );

    await sendMessage(chatId, "✅ Solicitud recibida.\n\nUn administrador revisará tu usuario, monto y plataforma.\n\nCuando esté listo, te vamos a pedir los datos de acreditación.");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_cvu") {
    session.withdrawCvu = text;
    session.step = "withdraw_holder";
    sessions[chatId] = session;
    await sendMessage(chatId, "Perfecto ✅\n\nAhora enviame el titular de la cuenta.");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_holder") {
    session.withdrawHolder = text;
    session.step = "withdraw_bank";
    sessions[chatId] = session;
    await sendMessage(chatId, "Bien ✅\n\nAhora enviame el nombre del banco o billetera.");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_bank") {
    session.withdrawBank = text;
    session.step = "withdraw_done";
    sessions[chatId] = session;

    await sendMessage(
      ADMIN_ID,
      `💸 <b>DATOS PARA ACREDITAR RETIRO</b>

Origen: ${sessionSourceLabel}
CVU/CBU: ${session.withdrawCvu}
Titular: ${session.withdrawHolder}
Banco/Billetera: ${session.withdrawBank}

Telegram:
ID: ${chatId}
Username: @${username}
Nombre Telegram: ${firstName} ${lastName}`,
      adminButtons(chatId)
    );

    await sendMessage(ADMIN_ID, "📎 Cuando realices el pago, usá:\n\n" + `/comprobantepago ${chatId}`);
    await sendMessage(chatId, "✅ Datos recibidos.\n\nUn administrador realizará la acreditación y te enviará el comprobante por este chat.");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "load_user") {
    session.loadUser = text;
    session.step = "load_platform";
    sessions[chatId] = session;
    await sendMessage(chatId, "Perfecto. Ahora elegí la plataforma:", platformMenu());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "load_platform") {
    const platforms = ["💫 Bet Space", "🌟 Ganamosnet Org", "⚡️ Zeus (multi)"];
    if (!platforms.includes(text)) {
      await sendMessage(chatId, "Elegí una plataforma usando los botones:", platformMenu());
      return res.status(200).json({ ok: true });
    }

    session.loadPlatform = text;
    session.step = "waiting_receipt";
    sessions[chatId] = session;

    await updateUserStatus(chatId, "Carga solicitada");

    await sendMessage(
      ADMIN_ID,
      `💳 <b>SOLICITUD DE CARGA</b>

Origen: ${sessionSourceLabel}
👤 Usuario: ${session.loadUser}
🎮 Plataforma: ${session.loadPlatform}

Telegram:
ID: ${chatId}
Username: @${username}
Nombre Telegram: ${firstName} ${lastName}`,
      adminButtons(chatId)
    );

    await sendMessage(
      chatId,
      `💳 <b>Datos para cargar</b>

🏦 Alias:
<code>redcoronabet7</code>

🔢 CVU:
<code>000177500393009854128</code>

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego de transferir, enviá el comprobante por este mismo chat.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`,
      mainMenu()
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "name") {
    session.name = text;
    session.step = "platform";
    sessions[chatId] = session;
    await sendMessage(chatId, "Perfecto. Ahora elegí la plataforma:", platformMenu());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "platform") {
    const platforms = ["💫 Bet Space", "🌟 Ganamosnet Org", "⚡️ Zeus (multi)"];
    if (!platforms.includes(text)) {
      await sendMessage(chatId, "Elegí una plataforma usando los botones:", platformMenu());
      return res.status(200).json({ ok: true });
    }

    session.platform = text;
    session.step = "phone";
    sessions[chatId] = session;
    await sendMessage(chatId, "Ahora enviame tu teléfono de contacto:");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "phone") {
    session.phone = text;
    session.step = "country";
    sessions[chatId] = session;
    await sendMessage(chatId, "¿De qué país sos?");
    return res.status(200).json({ ok: true });
  }

  if (session.step === "country") {
    session.country = text;
    session.step = "done";
    sessions[chatId] = session;

    const adminMessage =
      `🚨 <b>NUEVA SOLICITUD DE USUARIO</b>

Origen: ${sessionSourceLabel}
👤 Nombre: ${session.name}
🎮 Plataforma: ${session.platform}
📞 Teléfono: ${session.phone}
🌍 País: ${session.country}

Telegram:
ID: ${chatId}
Username: @${username}
Nombre Telegram: ${firstName} ${lastName}`;

    await sendMessage(
      ADMIN_ID,
      adminMessage,
      adminButtons(chatId)
    );

    await saveUserToSheet({
      origen: sessionSourceLabel,
      telegramId: chatId,
      username: `@${username}`,
      nombreTelegram: `${firstName} ${lastName}`,
      nombre: session.name,
      plataforma: session.platform,
      telefono: session.phone,
      pais: session.country,
      estado: "Registrado"
    });

    await sendMetaEvent("Lead", chatId, {
      source: sessionSourceLabel,
      platform: session.platform,
      country: session.country,
      status: "Registrado"
    });

    await sendMessage(
      chatId,
      `✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

💳 DATOS PARA CARGAR

🏦 Alias:
redcoronabet.7

🔢 CVU:
0000177507338008821880

👤 Titular:
Elias Nicolas Palet

✅ Luego de transferir, enviá el comprobante por este mismo chat.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.

📢 Mientras tanto podés unirte al canal oficial o solicitar acceso VIP.`
    );

    return res.status(200).json({ ok: true });
  }

  await sendMessage(chatId, "Seleccioná una opción del menú:", mainMenu());
  return res.status(200).json({ ok: true });
}
