const { google } = require("googleapis");
const { createHash } = require("crypto");

const ADMIN_ID = "8291674623";
const sessions = {};

function nowDate() {
  return new Date().toLocaleString("es-AR");
}

function hashValue(value) {
  return createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML"
    })
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
  console.log("Respuesta WhatsApp:", data);
}

async function sendMetaEvent(eventName, whatsappId, customData = {}) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) return;

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
    console.log("Evento Meta:", eventName, result);
  } catch (error) {
    console.error("Error Meta CAPI:", error);
  }
}

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

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
      range: "A:X",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          nowDate(),
          data.origen,
          data.whatsappId,
          data.username,
          data.nombreWhatsapp,
          data.nombre,
          data.plataforma,
          data.telefono,
          data.pais,
          data.estado,
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
    console.error("Error guardando en Sheets:", error);
    await sendTelegram(ADMIN_ID, "⚠️ Error guardando usuario de WhatsApp en Google Sheets.");
  }
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
  try {
    const sheets = getSheetsClient();
    const found = await findUserRowById(userId);

    if (!found) {
      await sendTelegram(ADMIN_ID, `⚠️ No encontré el usuario ${userId} en Sheets.`);
      return false;
    }

    const row = found.row;

    const estado = status || row[9] || "";
    const primeraCarga = extras.primeraCarga ?? row[10] ?? "";
    const fechaCarga = extras.fechaCarga ?? row[11] ?? "";
    const ultimoRetiro = extras.ultimoRetiro ?? row[12] ?? "";
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
  } catch (error) {
    console.error("Error actualizando Sheets:", error);
    await sendTelegram(ADMIN_ID, "⚠️ Error actualizando estado en Sheets.");
    return false;
  }
}

function mainMenuText() {
  return `👑 Bienvenido a Red Corona Bett

Seleccioná una opción respondiendo con el número:

1️⃣ Crear Usuario
2️⃣ Cargar
3️⃣ Gané y quiero retirar
4️⃣ Hablar con un ADM
5️⃣ Canal Oficial
6️⃣ Beneficios`;
}

function platformText() {
  return `Elegí la plataforma:

1️⃣ Bet Space
2️⃣ Ganamosnet Org
3️⃣ Zeus (multi)
0️⃣ Volver`;
}

function benefitsText() {
  return `🎁 Beneficios

1️⃣ Bono de Bienvenida
2️⃣ Recomendación
3️⃣ Fidelidad
0️⃣ Volver`;
}

function normalizePlatform(text) {
  if (text === "1") return "💫 Bet Space";
  if (text === "2") return "🌟 Ganamosnet Org";
  if (text === "3") return "⚡️ Zeus (multi)";
  return null;
}

module.exports = async function handler(req, res) {
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
    const session = sessions[from] || {};
    const origen = "🟢 WHATSAPP";

    if (text === "0" || text.toLowerCase() === "menu" || text.toLowerCase() === "hola") {
      sessions[from] = {};
      await sendMetaEvent("BotStart", from, { source: origen });
      await sendTelegram(ADMIN_ID, `👀 <b>WHATSAPP START</b>\n\nID: ${from}\nNombre: ${contactName}`);
      await sendWhatsApp(from, mainMenuText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "1" && !session.step) {
      sessions[from] = { step: "name" };
      await sendMetaEvent("RegistroIniciado", from, { source: origen });
      await sendTelegram(ADMIN_ID, `🎮 <b>REGISTRO INICIADO WHATSAPP</b>\n\nID: ${from}\nNombre: ${contactName}`);
      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuál es tu nombre?");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "2" && !session.step) {
      sessions[from] = { step: "load_user" };
      await sendMetaEvent("CargaIniciada", from, { source: origen });
      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "3" && !session.step) {
      sessions[from] = { step: "withdraw_user" };
      await sendMetaEvent("RetiroIniciado", from, { source: origen });
      await sendWhatsApp(from, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "4" && !session.step) {
      await sendMetaEvent("ContactoADM", from, { source: origen });
      await sendWhatsApp(from, "Podés hablar con un administrador acá:\n\nhttps://t.me/Eliamcorona");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "5" && !session.step) {
      await updateUserStatus(from, null, { canalOficial: "SI" });
      await sendMetaEvent("CanalOficial", from, { source: origen });
      await sendWhatsApp(from, "📢 Canal Oficial\n\nUnite desde acá:\nhttps://t.me/redcoronabet");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text === "6" && !session.step) {
      await sendMetaEvent("Beneficios", from, { source: origen });
      await sendWhatsApp(from, benefitsText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "name") {
      session.name = text;
      session.step = "platform";
      sessions[from] = session;
      await sendWhatsApp(from, platformText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "platform") {
      const platform = normalizePlatform(text);

      if (!platform) {
        await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
        return res.status(200).send("EVENT_RECEIVED");
      }

      session.platform = platform;
      session.step = "phone";
      sessions[from] = session;
      await sendWhatsApp(from, "Ahora enviame tu teléfono de contacto:");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "phone") {
      session.phone = text;
      session.step = "country";
      sessions[from] = session;
      await sendWhatsApp(from, "¿De qué país sos?");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "country") {
      session.country = text;
      session.step = "done";
      sessions[from] = session;

      await saveUserToSheet({
        origen,
        whatsappId: from,
        username: "",
        nombreWhatsapp: contactName,
        nombre: session.name,
        plataforma: session.platform,
        telefono: session.phone,
        pais: session.country,
        estado: "Registrado"
      });

      await sendMetaEvent("CompleteRegistration", from, {
        source: origen,
        platform: session.platform,
        country: session.country,
        status: "Registrado"
      });

      await sendMetaEvent("Lead", from, {
        source: origen,
        platform: session.platform,
        country: session.country,
        status: "Registrado"
      });

      await sendTelegram(
        ADMIN_ID,
        `🚨 <b>NUEVA SOLICITUD WHATSAPP</b>

Origen: ${origen}
👤 Nombre: ${session.name}
🎮 Plataforma: ${session.platform}
📞 Teléfono: ${session.phone}
🌍 País: ${session.country}

WhatsApp:
ID: ${from}
Nombre WhatsApp: ${contactName}

Para enviar usuario usá:
/enviarusuario ${from} USUARIO CONTRASEÑA LINK`
      );

      await sendWhatsApp(
        from,
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

      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "load_user") {
      session.loadUser = text;
      session.step = "load_platform";
      sessions[from] = session;
      await sendWhatsApp(from, platformText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "load_platform") {
      const platform = normalizePlatform(text);

      if (!platform) {
        await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
        return res.status(200).send("EVENT_RECEIVED");
      }

      session.loadPlatform = platform;
      session.step = "waiting_receipt";
      sessions[from] = session;

      await updateUserStatus(from, "Carga solicitada");
      await sendMetaEvent("CargaSolicitada", from, { source: origen, platform });

      await sendTelegram(
        ADMIN_ID,
        `💳 <b>SOLICITUD DE CARGA WHATSAPP</b>

Origen: ${origen}
👤 Usuario: ${session.loadUser}
🎮 Plataforma: ${platform}

WhatsApp:
ID: ${from}
Nombre: ${contactName}`
      );

      await sendWhatsApp(
        from,
        `💳 DATOS PARA CARGAR

🏦 Alias:
redcoronabet7

🔢 CVU:
000177500393009854128

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego de transferir, enviá el comprobante por este mismo chat.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`
      );

      return res.status(200).send("EVENT_RECEIVED");
    }

    if (message.image || message.document) {
      await updateUserStatus(from, "Comprobante recibido");

      await sendMetaEvent("ComprobanteRecibido", from, {
        status: "Comprobante recibido",
        source: origen
      });

      await sendTelegram(
        ADMIN_ID,
        `📎 <b>COMPROBANTE RECIBIDO WHATSAPP</b>

Origen: ${origen}
ID: ${from}
Nombre: ${contactName}

Para confirmar carga usá:
/cargo ${from} MONTO`
      );

      await sendWhatsApp(from, "✅ Comprobante recibido.\n\nUn administrador lo revisará y acreditará tu carga a la brevedad.");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_user") {
      session.withdrawUser = text;
      session.step = "withdraw_platform";
      sessions[from] = session;
      await sendWhatsApp(from, platformText());
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_platform") {
      const platform = normalizePlatform(text);

      if (!platform) {
        await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
        return res.status(200).send("EVENT_RECEIVED");
      }

      session.withdrawPlatform = platform;
      session.step = "withdraw_amount";
      sessions[from] = session;
      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuánto querés retirar?");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_amount") {
      session.withdrawAmount = text;
      session.step = "withdraw_waiting_admin";
      sessions[from] = session;

      await updateUserStatus(from, "Retiro solicitado", {
        ultimoRetiro: session.withdrawAmount,
        fechaRetiro: nowDate()
      });

      await sendMetaEvent("RetiroSolicitado", from, {
        value: toNumber(session.withdrawAmount),
        currency: "ARS",
        source: origen,
        platform: session.withdrawPlatform
      });

      await sendTelegram(
        ADMIN_ID,
        `🥳💸 <b>SOLICITUD DE RETIRO WHATSAPP</b>

Origen: ${origen}
👤 Usuario: ${session.withdrawUser}
💰 Monto: ${session.withdrawAmount}
🎮 Plataforma: ${session.withdrawPlatform}

WhatsApp:
ID: ${from}
Nombre: ${contactName}

Cuando retires las fichas, usá:
/retiroconfirmado ${from}`
      );

      await sendWhatsApp(from, "✅ Solicitud recibida.\n\nUn administrador revisará tu usuario, monto y plataforma.\n\nCuando esté listo, te vamos a pedir los datos de acreditación.");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_cvu") {
      session.withdrawCvu = text;
      session.step = "withdraw_holder";
      sessions[from] = session;
      await sendWhatsApp(from, "Perfecto ✅\n\nAhora enviame el titular de la cuenta.");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_holder") {
      session.withdrawHolder = text;
      session.step = "withdraw_bank";
      sessions[from] = session;
      await sendWhatsApp(from, "Bien ✅\n\nAhora enviame el nombre del banco o billetera.");
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (session.step === "withdraw_bank") {
      session.withdrawBank = text;
      session.step = "withdraw_done";
      sessions[from] = session;

      await sendTelegram(
        ADMIN_ID,
        `💸 <b>DATOS PARA ACREDITAR RETIRO WHATSAPP</b>

Origen: ${origen}
CVU/CBU: ${session.withdrawCvu}
Titular: ${session.withdrawHolder}
Banco/Billetera: ${session.withdrawBank}

WhatsApp:
ID: ${from}
Nombre: ${contactName}

Cuando pagues, usá:
/retiropagado ${from}`
      );

      await sendWhatsApp(from, "✅ Datos recibidos.\n\nUn administrador realizará la acreditación y te avisará por este chat.");
      return res.status(200).send("EVENT_RECEIVED");
    }

    await sendWhatsApp(from, mainMenuText());
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(500).send("Internal Server Error");
  }
};
