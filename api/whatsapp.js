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
  return Array.from({ length: 24 }, (_, i) => row[i] || "");
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
  if (updates.observaciones !== undefined) row[21] = updates.observaciones;
  if (updates.fechaBloqueo !== undefined) row[22] = updates.fechaBloqueo;
  if (updates.motivoBloqueo !== undefined) row[23] = updates.motivoBloqueo;

  await saveFullRow(found.rowNumber, row);
  return true;
}

function getStatus(row) {
  return String(row[9] || "MENU").trim();
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
3️⃣ Zeus
0️⃣ Volver`;
}

function benefitsText() {
  return `🎁 Beneficios disponibles

1️⃣ Bono de Bienvenida
2️⃣ Recomendación
3️⃣ Fidelidad

0️⃣ Volver`;
}

function normalizePlatform(text) {
  if (text === "1") return "Bet Space";
  if (text === "2") return "Ganamosnet Org";
  if (text === "3") return "Zeus";
  return null;
}

async function notifyAdmin(title, from, contactName, extra = "") {
  await sendTelegram(
    ADMIN_ID,
    `${title}

ID: <code>${from}</code>
Nombre: ${contactName}
${extra}`,
    adminButtons(from)
  );
}

async function handleMediaMessage(from, contactName, message) {
  await updateUser(from, {
    estado: "COMPROBANTE_RECIBIDO",
    observaciones: "Comprobante recibido por WhatsApp"
  });

  await notifyAdmin(
    "📎 <b>COMPROBANTE RECIBIDO WHATSAPP</b>",
    from,
    contactName,
    "\nUsá los botones para continuar."
  );

  await sendMetaEvent("ComprobanteRecibido", from, {
    source: "whatsapp"
  });

  await sendWhatsApp(
    from,
    "✅ Comprobante recibido.\n\nUn administrador lo revisará y te confirmará a la brevedad."
  );
}

async function handleUserText(from, contactName, text) {
  const found = await getOrCreateUser(from, contactName);
  const row = normalizeRow(found.row);
  const status = getStatus(row);

  const lower = text.toLowerCase();

  if (lower === "menu" || text === "0") {
    await updateUser(from, { estado: "MENU", nombreWhatsapp: contactName });
    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (lower === "hola" && status === "MENU") {
    await updateUser(from, { estado: "MENU", nombreWhatsapp: contactName });
    await sendMetaEvent("BotStart", from, { source: "whatsapp" });
    await notifyAdmin("👀 <b>WHATSAPP START</b>", from, contactName);
    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "MENU") {
    if (text === "1") {
      await updateUser(from, {
        estado: "REG_NOMBRE",
        nombreWhatsapp: contactName
      });

      await sendMetaEvent("RegistroIniciado", from, {
        source: "whatsapp"
      });

      await notifyAdmin(
        "🎮 <b>REGISTRO INICIADO WHATSAPP</b>",
        from,
        contactName
      );

      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await updateUser(from, {
        estado: "CARGA_USUARIO",
        nombreWhatsapp: contactName
      });

      await sendMetaEvent("CargaIniciada", from, {
        source: "whatsapp"
      });

      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "3") {
      await updateUser(from, {
        estado: "RETIRO_USUARIO",
        nombreWhatsapp: contactName
      });

      await sendMetaEvent("RetiroIniciado", from, {
        source: "whatsapp"
      });

      await sendWhatsApp(from, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "4") {
      await sendMetaEvent("ContactoADM", from, {
        source: "whatsapp"
      });

      await notifyAdmin(
        "👨‍💼 <b>CLIENTE PIDE ADM WHATSAPP</b>",
        from,
        contactName
      );

      await sendWhatsApp(
        from,
        "👨‍💼 Un administrador fue notificado.\n\nTambién podés escribir por Telegram:\nhttps://t.me/Eliamcorona"
      );
      return;
    }

    if (text === "5") {
      await updateUser(from, {
        canalOficial: "SI",
        nombreWhatsapp: contactName
      });

      await sendMetaEvent("CanalOficial", from, {
        source: "whatsapp"
      });

      await sendWhatsApp(
        from,
        "📢 Canal Oficial\n\nUnite desde acá:\nhttps://t.me/redcoronabet"
      );
      return;
    }

    if (text === "6") {
      await sendMetaEvent("Beneficios", from, {
        source: "whatsapp"
      });

      await sendWhatsApp(from, benefitsText());
      return;
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "REG_NOMBRE") {
    await updateUser(from, {
      estado: "REG_PLATAFORMA",
      nombre: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "REG_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "REG_TELEFONO",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Ahora enviame tu teléfono de contacto:");
    return;
  }

  if (status === "REG_TELEFONO") {
    await updateUser(from, {
      estado: "REG_PAIS",
      telefono: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "¿De qué país sos?");
    return;
  }

  if (status === "REG_PAIS") {
    await updateUser(from, {
      estado: "REGISTRADO",
      pais: text,
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendMetaEvent("CompleteRegistration", from, {
      source: "whatsapp",
      platform: r[6] || "",
      country: text,
      status: "Registrado"
    });

    await sendMetaEvent("Lead", from, {
      source: "whatsapp",
      platform: r[6] || "",
      country: text,
      status: "Registrado"
    });

    await sendTelegram(
      ADMIN_ID,
      `🚨 <b>NUEVA SOLICITUD WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Nombre: ${r[5] || ""}
🎮 Plataforma: ${r[6] || ""}
📞 Teléfono: ${r[7] || ""}
🌍 País: ${text}

WhatsApp:
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

Usá los botones para continuar.`,
      adminButtons(from)
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

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`
    );

    return;
  }

  if (status === "REGISTRADO" || status === "USUARIO_ENVIADO" || status === "CARGA_CONFIRMADA" || status === "COMPROBANTE_RECIBIDO" || status === "RETIRO_CONFIRMADO") {
    if (text === "1") {
      await updateUser(from, {
        estado: "REG_NOMBRE",
        nombreWhatsapp: contactName
      });
      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await updateUser(from, {
        estado: "CARGA_USUARIO",
        nombreWhatsapp: contactName
      });
      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "3") {
      await updateUser(from, {
        estado: "RETIRO_USUARIO",
        nombreWhatsapp: contactName
      });
      await sendWhatsApp(from, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "CARGA_USUARIO") {
    await updateUser(from, {
      estado: "CARGA_PLATAFORMA",
      username: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "CARGA_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "CARGA_ESPERANDO_COMPROBANTE",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await sendMetaEvent("CargaSolicitada", from, {
      source: "whatsapp",
      platform
    });

    await notifyAdmin(
      "💳 <b>SOLICITUD DE CARGA WHATSAPP</b>",
      from,
      contactName,
      `\nUsuario: ${row[3] || ""}\nPlataforma: ${platform}`
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

✅ Luego de transferir, enviá el comprobante por este mismo chat.`
    );

    return;
  }

  if (status === "RETIRO_USUARIO") {
    await updateUser(from, {
      estado: "RETIRO_PLATAFORMA",
      username: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "RETIRO_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "RETIRO_MONTO",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuánto querés retirar?");
    return;
  }

  if (status === "RETIRO_MONTO") {
    await updateUser(from, {
      estado: "RETIRO_SOLICITADO",
      ultimoRetiro: text,
      fechaRetiro: nowDate(),
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendMetaEvent("RetiroSolicitado", from, {
      value: toNumber(text),
      currency: "ARS",
      source: "whatsapp",
      platform: r[6] || ""
    });

    await sendTelegram(
      ADMIN_ID,
      `🥳💸 <b>SOLICITUD DE RETIRO WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Usuario: ${r[3] || ""}
💰 Monto: ${text}
🎮 Plataforma: ${r[6] || ""}

WhatsApp:
ID: <code>${from}</code>
Nombre: ${contactName}`,
      adminButtons(from)
    );

    await sendWhatsApp(
      from,
      "✅ Solicitud recibida.\n\nUn administrador revisará tu usuario, monto y plataforma."
    );

    return;
  }

  await sendWhatsApp(from, mainMenuText());
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

    await getOrCreateUser(from, contactName);

    if (message.image || message.document) {
      await handleMediaMessage(from, contactName, message);
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text) {
      await handleUserText(from, contactName, text);
      return res.status(200).send("EVENT_RECEIVED");
    }

    await sendWhatsApp(from, mainMenuText());
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
};

async function handleUserText(from, contactName, text) {
  const found = await getOrCreateUser(from, contactName);
  const row = normalizeRow(found.row);
  const status = getStatus(row);
  const lower = String(text || "").toLowerCase();

  if (lower === "menu" || text === "0" || lower === "hola") {
    await updateUser(from, { estado: "MENU", nombreWhatsapp: contactName });

    if (lower === "hola") {
      await sendMetaEvent("BotStart", from, { source: "whatsapp" });
      await notifyAdmin("👀 <b>WHATSAPP START</b>", from, contactName);
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "MENU") {
    if (text === "1") {
      await updateUser(from, { estado: "REG_NOMBRE", nombreWhatsapp: contactName });
      await sendMetaEvent("RegistroIniciado", from, { source: "whatsapp" });
      await notifyAdmin("🎮 <b>REGISTRO INICIADO WHATSAPP</b>", from, contactName);
      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await updateUser(from, { estado: "CARGA_USUARIO", nombreWhatsapp: contactName });
      await sendMetaEvent("CargaIniciada", from, { source: "whatsapp" });
      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "3") {
      await updateUser(from, { estado: "RETIRO_USUARIO", nombreWhatsapp: contactName });
      await sendMetaEvent("RetiroIniciado", from, { source: "whatsapp" });
      await sendWhatsApp(from, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "4") {
      await sendMetaEvent("ContactoADM", from, { source: "whatsapp" });
      await notifyAdmin("👨‍💼 <b>CLIENTE PIDE ADM WHATSAPP</b>", from, contactName);
      await sendWhatsApp(from, "👨‍💼 Un administrador fue notificado.\n\nTambién podés escribir por Telegram:\nhttps://t.me/Eliamcorona");
      return;
    }

    if (text === "5") {
      await updateUser(from, { canalOficial: "SI", nombreWhatsapp: contactName });
      await sendMetaEvent("CanalOficial", from, { source: "whatsapp" });
      await sendWhatsApp(from, "📢 Canal Oficial\n\nUnite desde acá:\nhttps://t.me/redcoronabet");
      return;
    }

    if (text === "6") {
      await sendMetaEvent("Beneficios", from, { source: "whatsapp" });
      await sendWhatsApp(from, benefitsText());
      return;
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "REG_NOMBRE") {
    await updateUser(from, {
      estado: "REG_PLATAFORMA",
      nombre: text,
      nombreWhatsapp: contactName
    });
    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "REG_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "REG_TELEFONO",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Ahora enviame tu teléfono de contacto:");
    return;
  }

  if (status === "REG_TELEFONO") {
    await updateUser(from, {
      estado: "REG_PAIS",
      telefono: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "¿De qué país sos?");
    return;
  }

  if (status === "REG_PAIS") {
    await updateUser(from, {
      estado: "REGISTRADO",
      pais: text,
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendMetaEvent("CompleteRegistration", from, {
      source: "whatsapp",
      platform: r[6] || "",
      country: text,
      status: "Registrado"
    });

    await sendMetaEvent("Lead", from, {
      source: "whatsapp",
      platform: r[6] || "",
      country: text,
      status: "Registrado"
    });

    await sendTelegram(
      ADMIN_ID,
      `🚨 <b>NUEVA SOLICITUD WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Nombre: ${r[5] || ""}
🎮 Plataforma: ${r[6] || ""}
📞 Teléfono: ${r[7] || ""}
🌍 País: ${text}

WhatsApp:
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

Usá los botones para continuar.`,
      adminButtons(from)
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

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`
    );

    return;
  }

  if (
    status === "REGISTRADO" ||
    status === "USUARIO_ENVIADO" ||
    status === "Usuario enviado" ||
    status === "CARGA_CONFIRMADA" ||
    status === "Cargó" ||
    status === "COMPROBANTE_RECIBIDO" ||
    status === "Retiro solicitado" ||
    status === "RETIRO_CONFIRMADO" ||
    status === "Retiro pagado"
  ) {
    if (text === "1") {
      await updateUser(from, { estado: "REG_NOMBRE", nombreWhatsapp: contactName });
      await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await updateUser(from, { estado: "CARGA_USUARIO", nombreWhatsapp: contactName });
      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "3") {
      await updateUser(from, { estado: "RETIRO_USUARIO", nombreWhatsapp: contactName });
      await sendWhatsApp(from, "🥳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    await sendWhatsApp(from, mainMenuText());
    return;
  }

  if (status === "CARGA_USUARIO") {
    await updateUser(from, {
      estado: "CARGA_PLATAFORMA",
      username: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "CARGA_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "CARGA_ESPERANDO_COMPROBANTE",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendMetaEvent("CargaSolicitada", from, {
      source: "whatsapp",
      platform
    });

    await sendTelegram(
      ADMIN_ID,
      `💳 <b>SOLICITUD DE CARGA WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Usuario: ${r[3] || ""}
🎮 Plataforma: ${platform}

WhatsApp:
ID: <code>${from}</code>
Nombre: ${contactName}`,
      adminButtons(from)
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

✅ Luego de transferir, enviá el comprobante por este mismo chat.`
    );

    return;
  }

  if (status === "RETIRO_USUARIO") {
    await updateUser(from, {
      estado: "RETIRO_PLATAFORMA",
      username: text,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, platformText());
    return;
  }

  if (status === "RETIRO_PLATAFORMA") {
    const platform = normalizePlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "Elegí una plataforma válida:\n\n" + platformText());
      return;
    }

    await updateUser(from, {
      estado: "RETIRO_MONTO",
      plataforma: platform,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Perfecto ✅\n\n¿Cuánto querés retirar?");
    return;
  }

  if (status === "RETIRO_MONTO") {
    await updateUser(from, {
      estado: "RETIRO_SOLICITADO",
      ultimoRetiro: text,
      fechaRetiro: nowDate(),
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendMetaEvent("RetiroSolicitado", from, {
      value: toNumber(text),
      currency: "ARS",
      source: "whatsapp",
      platform: r[6] || ""
    });

    await sendTelegram(
      ADMIN_ID,
      `🥳💸 <b>SOLICITUD DE RETIRO WHATSAPP</b>

Origen: 🟢 WHATSAPP
👤 Usuario: ${r[3] || ""}
💰 Monto: ${text}
🎮 Plataforma: ${r[6] || ""}

WhatsApp:
ID: <code>${from}</code>
Nombre: ${contactName}`,
      adminButtons(from)
    );

    await sendWhatsApp(
      from,
      "✅ Solicitud recibida.\n\nUn administrador revisará tu usuario, monto y plataforma."
    );

    return;
  }

  if (status === "withdraw_cvu" || status === "RETIRO_CVU") {
    await updateUser(from, {
      estado: "RETIRO_TITULAR",
      observaciones: `CVU/CBU: ${text}`,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Perfecto ✅\n\nAhora enviame el titular de la cuenta.");
    return;
  }

  if (status === "RETIRO_TITULAR") {
    const oldObs = row[21] || "";

    await updateUser(from, {
      estado: "RETIRO_BANCO",
      observaciones: `${oldObs}\nTitular: ${text}`,
      nombreWhatsapp: contactName
    });

    await sendWhatsApp(from, "Bien ✅\n\nAhora enviame el nombre del banco o billetera.");
    return;
  }

  if (status === "RETIRO_BANCO") {
    const oldObs = row[21] || "";

    await updateUser(from, {
      estado: "RETIRO_DATOS_RECIBIDOS",
      observaciones: `${oldObs}\nBanco/Billetera: ${text}`,
      nombreWhatsapp: contactName
    });

    const refreshed = await findUserRowById(from);
    const r = normalizeRow(refreshed?.row || []);

    await sendTelegram(
      ADMIN_ID,
      `💸 <b>DATOS PARA ACREDITAR RETIRO WHATSAPP</b>

ID: <code>${from}</code>
Nombre: ${contactName}

${r[21] || ""}`,
      adminButtons(from)
    );

    await sendWhatsApp(
      from,
      "✅ Datos recibidos.\n\nUn administrador realizará la acreditación y te confirmará por este chat."
    );

    return;
  }

  await sendWhatsApp(from, mainMenuText());
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

    await getOrCreateUser(from, contactName);

    if (message.image || message.document) {
      await handleMediaMessage(from, contactName);
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text) {
      await handleUserText(from, contactName, text);
      return res.status(200).send("EVENT_RECEIVED");
    }

    await sendWhatsApp(from, mainMenuText());
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error general whatsapp webhook:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
};
