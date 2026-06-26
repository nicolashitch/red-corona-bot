import { google } from "googleapis";
import { createHash } from "crypto";

const ADMIN_ID = "8291674623";
const sessions = {};

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

function getSourceLabel(source) {
  if (source === "meta") return "🟢 META ADS";
  if (source === "whatsapp") return "🟢 WHATSAPP";
  return "⚪ Orgánico / Directo";
}

function getStartSource(text) {
  const parts = String(text || "").split(" ");
  return parts[1] || "direct";
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
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    };

    if (keyboard) body.reply_markup = keyboard;

    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log("Telegram Status:", response.status);
    console.log("Telegram Response:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error enviando Telegram:", error);
    return null;
  }
}

async function answerCallback(callbackId, text = "Listo ✅") {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false })
    });
  } catch (error) {
    console.error("Error respondiendo callback:", error);
  }
}

async function sendWhatsApp(to, text) {
  try {
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
      await sendMessage(ADMIN_ID, "⚠️ Faltan variables de WhatsApp en Vercel.");
      return null;
    }

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
    console.log("WhatsApp desde Telegram Status:", response.status);
    console.log("WhatsApp desde Telegram Response:", JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error("Error enviando WhatsApp desde Telegram:", error);
    return null;
  }
}

function isWhatsAppId(userId) {
  return /^\d{10,15}$/.test(String(userId || ""));
}

async function sendToUser(userId, text) {
  if (isWhatsAppId(userId)) return await sendWhatsApp(userId, text);
  return await sendMessage(userId, text);
}

async function getRows() {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:X"
  });
  return response.data.values || [];
}

async function saveUserToSheet(data) {
  try {
    const sheets = getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "A:X",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          nowDate(),
          data.origen,
          data.telegramId || data.userId || "",
          data.username || "",
          data.nombreTelegram || "",
          data.nombre || "",
          data.plataforma || "",
          data.telefono || "",
          data.pais || "",
          data.estado || "Registrado",
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
        ]]
      }
    });
  } catch (error) {
    console.error("Error guardando en Google Sheets:", error);
    await sendMessage(ADMIN_ID, "⚠️ Error guardando usuario en Google Sheets. El bot sigue funcionando.");
  }
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

async function updateUserStatus(userId, status, extras = {}) {
  try {
    const sheets = getSheetsClient();
    const found = await findUserRowById(userId);

    if (!found) {
      await sendMessage(ADMIN_ID, `⚠️ No encontré el usuario <code>${userId}</code> en Google Sheets.`);
      return false;
    }

    const row = found.row;

    const estado = status || row[9] || "";
    const primeraCarga = extras.primeraCarga ?? row[10] ?? "";
    const fechaCarga = extras.fechaCarga ?? row[11] ?? "";
    const ultimoRetiro = extras.ultimoRetiro ?? extras.primerRetiro ?? row[12] ?? "";
    const fechaRetiro = extras.fechaRetiro ?? row[13] ?? "";

    const totalCargadoActual = toNumber(row[14]);
    const totalRetiradoActual = toNumber(row[15]);

    const cargaNueva = toNumber(extras.sumarCarga);
    const retiroNuevo = toNumber(extras.sumarRetiro);

    const totalCargado = extras.totalCargado ?? (cargaNueva ? totalCargadoActual + cargaNueva : row[14] ?? "");
    const totalRetirado = extras.totalRetirado ?? (retiroNuevo ? totalRetiradoActual + retiroNuevo : row[15] ?? "");
    const saldoNeto = toNumber(totalCargado) - toNumber(totalRetirado);

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `J${found.rowNumber}:X${found.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          estado,
          primeraCarga,
          fechaCarga,
          ultimoRetiro,
          fechaRetiro,
          totalCargado,
          totalRetirado,
          saldoNeto,
          extras.ultimaActividad ?? nowDate(),
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

function adminActionButtons(userId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirmar carga", callback_data: `confirmar_carga_${userId}` },
        { text: "📩 Enviar usuario", callback_data: `enviar_usuario_${userId}` }
      ],
      [
        { text: "💸 Retiro realizado", callback_data: `retiro_realizado_${userId}` },
        { text: "✅ Pago enviado", callback_data: `pago_enviado_${userId}` }
      ],
      [
        { text: "📋 Ver perfil", callback_data: `ver_perfil_${userId}` },
        { text: "💬 Responder", callback_data: `responder_${userId}` }
      ]
    ]
  };
}

function parseCallbackData(data) {
  const value = String(data || "");

  const colon = value.match(/^([a-z_]+):(.+)$/);
  if (colon) return { action: colon[1], userId: colon[2] };

  const actions = [
    "confirmar_carga",
    "enviar_usuario",
    "retiro_realizado",
    "pago_enviado",
    "ver_perfil",
    "responder",
    "rechazar",
    "confirmar_retiro"
  ];

  for (const action of actions) {
    const prefix = `${action}_`;
    if (value.startsWith(prefix)) {
      return { action, userId: value.slice(prefix.length) };
    }
  }

  return { action: value, userId: "" };
}

async function sendProfile(userId) {
  const found = await findUserRowById(userId);

  if (!found) {
    await sendMessage(ADMIN_ID, `⚠️ No encontré el usuario <code>${userId}</code> en Google Sheets.`);
    return;
  }

  const r = found.row;

  await sendMessage(
    ADMIN_ID,
    `📋 <b>PERFIL DEL USUARIO</b>

ID: <code>${userId}</code>
Origen: ${r[1] || ""}
Username/Contacto: ${r[3] || ""}
Nombre Telegram/WhatsApp: ${r[4] || ""}
Nombre: ${r[5] || ""}
Plataforma: ${r[6] || ""}
Teléfono: ${r[7] || ""}
País: ${r[8] || ""}
Estado: ${r[9] || ""}

Primera carga: ${r[10] || ""}
Último retiro: ${r[12] || ""}

Total cargado: ${r[14] || "0"}
Total retirado: ${r[15] || "0"}
Saldo neto: ${r[16] || "0"}

VIP: ${r[19] || "NO"}
Canal: ${r[20] || "NO"}`,
    adminActionButtons(userId)
  );
}

async function handleCallback(update) {
  const data = update.callback_query.data;
  const callbackId = update.callback_query.id;
  const adminChatId = update.callback_query.message.chat.id;
  const { action, userId } = parseCallbackData(data);

  await answerCallback(callbackId);

  if (!userId) {
    await sendMessage(adminChatId, "⚠️ Botón inválido.");
    return;
  }

  if (action === "confirmar_carga") {
    await sendMessage(adminChatId, `✅ Para confirmar carga usá:\n<code>/cargo ${userId} MONTO</code>`);
    return;
  }

  if (action === "enviar_usuario") {
    await sendMessage(adminChatId, `📩 Para enviar usuario usá:\n<code>/enviarusuario ${userId} USUARIO CONTRASEÑA LINK</code>`);
    return;
  }

  if (action === "confirmar_retiro" || action === "retiro_realizado") {
    sessions[userId] = { ...(sessions[userId] || {}), step: "withdraw_cvu" };

    await updateUserStatus(userId, "Retiro solicitado");
    await sendMetaEvent("RetiroSolicitado", userId, { status: "Retiro solicitado" });

    await sendToUser(userId, "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar.");
    await sendMessage(adminChatId, "✅ Se solicitó CVU/CBU al usuario.");
    return;
  }

  if (action === "pago_enviado") {
    await updateUserStatus(userId, "Retiro pagado", { fechaRetiro: nowDate() });
    await sendMetaEvent("RetiroPagado", userId, { status: "Retiro pagado" });

    await sendToUser(userId, "✅ Pago enviado.\n\nTu retiro fue acreditado correctamente.\n\nMuchas gracias.");
    await sendMessage(adminChatId, "✅ Aviso de pago enviado y estado actualizado.");
    return;
  }

  if (action === "ver_perfil") {
    await sendProfile(userId);
    return;
  }

  if (action === "responder") {
    sessions[ADMIN_ID] = { step: "reply_to_user", replyUserId: userId };
    await sendMessage(adminChatId, `💬 Escribí el mensaje que querés enviar a <code>${userId}</code>.`);
    return;
  }

  if (action === "rechazar") {
    await updateUserStatus(userId, "Rechazado");
    await sendToUser(userId, "❌ Tu solicitud fue revisada y no pudo ser aprobada. Escribí nuevamente si necesitás ayuda.");
    await sendMessage(adminChatId, `❌ Solicitud rechazada para <code>${userId}</code>.`);
    return;
  }

  await sendMessage(adminChatId, "⚠️ Acción no reconocida.");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("Red Corona Bot Online");
    }

    const update = req.body;

    if (update.callback_query) {
      await handleCallback(update);
      return res.status(200).json({ ok: true });
    }

    if (!update.message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text || "";
    const username = update.message.from?.username || "Sin username";
    const firstName = update.message.from?.first_name || "";
    const lastName = update.message.from?.last_name || "";
    const currentSession = sessions[chatId] || {};
    const source = currentSession.source || "direct";
    const sourceLabel = getSourceLabel(source);

    if (String(chatId) === ADMIN_ID && sessions[ADMIN_ID]?.step === "reply_to_user" && text && !text.startsWith("/")) {
      const userId = sessions[ADMIN_ID].replyUserId;
      await sendToUser(userId, text);
      sessions[ADMIN_ID] = {};
      await sendMessage(ADMIN_ID, `💬 Mensaje enviado a <code>${userId}</code>.`);
      return res.status(200).json({ ok: true });
    }

    if ((text === "/start" || text === "/menu") && String(chatId) === ADMIN_ID) {
      await sendMessage(
        ADMIN_ID,
        `👑 <b>Panel ADM Red Corona Bett</b>

Comandos:
<code>/enviarusuario ID USUARIO CONTRASEÑA LINK</code>
<code>/cargo ID MONTO</code>
<code>/retiro ID MONTO</code>
<code>/retiroconfirmado ID</code>
<code>/comprobantepago ID</code>
<code>/responder ID MENSAJE</code>
<code>/perfil ID</code>`
      );
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/responder") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      const userId = parts[1];
      const msg = parts.slice(2).join(" ");

      if (!userId || !msg) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/responder ID MENSAJE");
        return res.status(200).json({ ok: true });
      }

      await sendToUser(userId, msg);
      await sendMessage(ADMIN_ID, `💬 Mensaje enviado a <code>${userId}</code>.`);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/perfil") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/perfil ID");
        return res.status(200).json({ ok: true });
      }

      await sendProfile(parts[1]);
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

      await updateUserStatus(userId, "Usuario enviado", { observaciones: `Usuario: ${user}` });
      await sendMetaEvent("UsuarioEnviado", userId, { status: "Usuario enviado" });

      await sendToUser(userId, `✅ <b>Tu acceso ya está listo</b>

👤 Usuario: ${user}
🔐 Contraseña: ${pass}
🔗 Link: ${link}

Cuando realices tu carga, enviá el comprobante por este mismo chat.`);

      await sendMessage(ADMIN_ID, "✅ Usuario enviado correctamente y estado actualizado.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/cargo") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/cargo ID MONTO");
        return res.status(200).json({ ok: true });
      }

      const userId = parts[1];
      const amount = parts.slice(2).join(" ");

      await updateUserStatus(userId, "Cargó", {
        primeraCarga: amount,
        fechaCarga: nowDate(),
        sumarCarga: amount
      });

      await sendMetaEvent("CargaRealizada", userId, {
        value: toNumber(amount),
        currency: "ARS",
        status: "Cargó"
      });

      await sendToUser(userId, "✅ Tu carga fue confirmada.\n\nFichas cargadas correctamente.\n\nMuchas gracias.");
      await sendMessage(ADMIN_ID, "✅ Estado actualizado: Cargó.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/retiro ") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/retiro ID MONTO");
        return res.status(200).json({ ok: true });
      }

      const userId = parts[1];
      const amount = parts.slice(2).join(" ");

      await updateUserStatus(userId, "Retiró", {
        ultimoRetiro: amount,
        fechaRetiro: nowDate(),
        sumarRetiro: amount
      });

      await sendMetaEvent("RetiroRealizado", userId, {
        value: toNumber(amount),
        currency: "ARS",
        status: "Retiró"
      });

      await sendMessage(ADMIN_ID, "✅ Estado actualizado: Retiró.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/perdido") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/perdido ID");
        return res.status(200).json({ ok: true });
      }

      await updateUserStatus(parts[1], "Perdido");
      await sendMetaEvent("UsuarioPerdido", parts[1], { status: "Perdido" });
      await sendMessage(ADMIN_ID, "✅ Estado actualizado: Perdido.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/vip") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/vip ID");
        return res.status(200).json({ ok: true });
      }

      await updateUserStatus(parts[1], "VIP", { vip: "SI" });
      await sendMetaEvent("UsuarioVIP", parts[1], { status: "VIP" });
      await sendMessage(ADMIN_ID, "✅ Estado actualizado: VIP.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/bloqueado") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/bloqueado ID MOTIVO");
        return res.status(200).json({ ok: true });
      }

      const userId = parts[1];
      const motivo = parts.slice(2).join(" ") || "Sin motivo";

      await updateUserStatus(userId, "Bloqueado", {
        fechaBloqueo: nowDate(),
        motivoBloqueo: motivo
      });

      await sendMetaEvent("UsuarioBloqueado", userId, { status: "Bloqueado", motivo });
      await sendMessage(ADMIN_ID, "✅ Estado actualizado: Bloqueado.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/retiroconfirmado") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/retiroconfirmado ID");
        return res.status(200).json({ ok: true });
      }

      const userId = parts[1];
      sessions[userId] = { ...(sessions[userId] || {}), step: "withdraw_cvu" };

      await updateUserStatus(userId, "Retiro solicitado");
      await sendMetaEvent("RetiroSolicitado", userId, { status: "Retiro solicitado" });

      await sendToUser(userId, "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar.");
      await sendMessage(ADMIN_ID, "✅ Se solicitó CVU/CBU al usuario.");
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith("/comprobantepago") && String(chatId) === ADMIN_ID) {
      const parts = text.split(" ");
      if (!parts[1]) {
        await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/comprobantepago ID");
        return res.status(200).json({ ok: true });
      }

      sessions[ADMIN_ID] = { step: "waiting_payment_receipt", paymentUserId: parts[1] };
      await sendMessage(ADMIN_ID, "Perfecto ✅\n\nAhora enviá la foto o PDF del comprobante de pago.");
      return res.status(200).json({ ok: true });
    }

    if (update.message.photo || update.message.document) {
      const adminSession = sessions[ADMIN_ID];

      if (String(chatId) === ADMIN_ID && adminSession?.step === "waiting_payment_receipt") {
        const userId = adminSession.paymentUserId;

        await updateUserStatus(userId, "Retiro pagado", { fechaRetiro: nowDate() });
        await sendMetaEvent("RetiroPagado", userId, { status: "Retiro pagado" });

        await sendToUser(userId, "✅ Pago enviado.\n\nTu retiro fue acreditado correctamente.\n\nMuchas gracias.");
        await sendMessage(ADMIN_ID, "✅ Aviso de pago enviado al usuario.\n\nAhora reenviá manualmente el comprobante si querés que también vea la imagen.");

        sessions[ADMIN_ID] = {};
        return res.status(200).json({ ok: true });
      }

      await updateUserStatus(chatId, "Comprobante recibido");
      await sendMetaEvent("ComprobanteRecibido", chatId, { status: "Comprobante recibido", source: sourceLabel });

      await sendMessage(
        ADMIN_ID,
        `📎 <b>COMPROBANTE RECIBIDO</b>

Origen: ${sourceLabel}
ID: <code>${chatId}</code>
Username: @${username}
Nombre: ${firstName} ${lastName}`,
        adminActionButtons(chatId)
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
Nombre: ${firstName} ${lastName}`
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
Nombre: ${firstName} ${lastName}`
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
      await sendMetaEvent("RetiroIniciado", chatId, { source: sourceLabel });
      await sendMessage(chatId, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return res.status(200).json({ ok: true });
    }

    if (text === "👨‍💼 Hablar con un ADM" || text === "/admin") {
      await sendMetaEvent("ContactoADM", chatId, { source: sourceLabel });
      await sendMessage(chatId, "Podés hablar con un administrador acá:\n\nhttps://t.me/Eliamcorona");
      return res.status(200).json({ ok: true });
    }

    if (text === "📢 Canal Oficial" || text === "/canal") {
      await updateUserStatus(chatId, null, { canalOficial: "SI" });
      await sendMetaEvent("CanalOficial", chatId, { source: sourceLabel });
      await sendMessage(chatId, "📢 Canal Oficial\n\nUnite desde acá:\nhttps://t.me/redcoronabet");
      return res.status(200).json({ ok: true });
    }

    if (text === "🎁 Beneficios" || text === "/beneficios" || text === "🎁 Reclamar Bonos") {
      await sendMetaEvent("Beneficios", chatId, { source: sourceLabel });
      await sendMessage(chatId, "🎁 Seleccioná el beneficio que querés consultar:", bonusesMenu());
      return res.status(200).json({ ok: true });
    }

    if (text === "🎉 Bono de Bienvenida") {
      await sendMetaEvent("BonoBienvenida", chatId, { source: sourceLabel });
      await sendMessage(chatId, "🎉 Bono de Bienvenida\n\nUna vez que tu usuario esté habilitado podés solicitar este beneficio.", bonusesMenu());
      return res.status(200).json({ ok: true });
    }

    if (text === "🤝 Recomendación") {
      await sendMetaEvent("Recomendacion", chatId, { source: sourceLabel });

      await sendMessage(
        chatId,
        "🤝 Recomendación\n\nEnviá una captura donde nos recomendaste y/o etiquetaste.\n\nPlataformas válidas:\n\n✅ Estados de WhatsApp\n✅ Facebook\n\nEtiqueta @recoronabetadm @nicolasmaximocorona\n\nY recibí tu premio 🥇 🏆 🥳",
        bonusesMenu()
      );

      await sendMessage(
        ADMIN_ID,
        `🤝 <b>SOLICITUD RECOMENDACIÓN</b>

Origen: ${sourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "💎 Fidelidad") {
      await sendMetaEvent("Fidelidad", chatId, { source: sourceLabel });

      await sendMessage(
        chatId,
        "💎 Fidelidad\n\nLuego de que tu recomendado realice su primera carga, ambos reciben su bono especial 🥳💸🎁💰\n\n♦️ Reclama el tuyo ahora.",
        bonusesMenu()
      );

      await sendMessage(
        ADMIN_ID,
        `💎 <b>SOLICITUD FIDELIDAD</b>

Origen: ${sourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "⭐ Acceso VIP") {
      await updateUserStatus(chatId, "Solicitud VIP");
      await sendMetaEvent("SolicitudVIP", chatId, { source: sourceLabel });

      await sendMessage(
        ADMIN_ID,
        `⭐ <b>SOLICITUD VIP</b>

Origen: ${sourceLabel}
ID: ${chatId}
Username: @${username}
Nombre: ${firstName} ${lastName}`
      );

      await sendMessage(
        chatId,
        "⭐ <b>Acceso VIP</b>\n\nLos usuarios VIP reciben atención prioritaria, beneficios exclusivos y acceso a un canal privado.\n\nRequisito: actividad superior a $100.000.\n\nTu solicitud fue enviada a un administrador.",
        afterRegisterMenu()
      );

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
        ultimoRetiro: session.withdrawAmount,
        fechaRetiro: nowDate()
      });

      await sendMetaEvent("RetiroSolicitado", chatId, {
        value: toNumber(session.withdrawAmount),
        currency: "ARS",
        source: sessionSourceLabel,
        platform: session.withdrawPlatform
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
        { inline_keyboard: [[{ text: "💸 Retiro realizado", callback_data: `retiro_realizado_${chatId}` }]] }
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
        { inline_keyboard: [[{ text: "✅ Pago enviado", callback_data: `pago_enviado_${chatId}` }]] }
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

      await sendMetaEvent("CargaSolicitada", chatId, {
        source: sessionSourceLabel,
        platform: session.loadPlatform
      });

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
        adminActionButtons(chatId)
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

      await sendMessage(ADMIN_ID, adminMessage, adminActionButtons(chatId));

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

      await sendMetaEvent("CompleteRegistration", chatId, {
        source: sessionSourceLabel,
        platform: session.platform,
        country: session.country,
        status: "Registrado"
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
redcoronabet7

🔢 CVU:
000177500393009854128

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego de transferir, enviá el comprobante por este mismo chat.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.

📢 Mientras tanto podés unirte al canal oficial o solicitar acceso VIP.`
      );

      return res.status(200).json({ ok: true });
    }

    await sendMessage(chatId, "Seleccioná una opción del menú:", mainMenu());
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error general Telegram webhook:", error);
    await sendMessage(ADMIN_ID, "⚠️ Error general en Telegram webhook. Revisá logs de Vercel.");
    return res.status(200).json({ ok: true });
  }
}
