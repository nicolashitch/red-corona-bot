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

function toNumber(value) {
  const n = Number(String(value || "").replace(/[^\d.,]/g, "").replace(",", "."));
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
  console.log("WhatsApp:", JSON.stringify(data, null, 2));
  return data;
}

async function sendTelegram(text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_ID,
      text,
      parse_mode: "HTML"
    })
  });
}

async function sendMetaEvent(eventName, userId, customData = {}) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) return;

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
    console.log("Meta:", eventName, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error Meta:", error);
  }
}

async function getRows() {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:N"
  });
  return response.data.values || [];
}

function normalizeRow(row = []) {
  return Array.from({ length: 14 }, (_, i) => row[i] || "");
}

async function findUserRow(userId) {
  const rows = await getRows();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || "") === String(userId)) {
      return { rowNumber: i + 1, row: rows[i] };
    }
  }
  return null;
}

async function createUser(userId, contactName) {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: "A:N",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        nowDate(),
        "🟢 WHATSAPP",
        userId,
        "",
        contactName,
        "",
        "",
        userId,
        "",
        "MENU",
        "",
        "",
        "",
        ""
      ]]
    }
  });

  return await findUserRow(userId);
}

async function getOrCreateUser(userId, contactName) {
  const found = await findUserRow(userId);
  if (found) return found;
  return await createUser(userId, contactName);
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

async function updateUser(userId, contactName, updates = {}) {
  const found = await getOrCreateUser(userId, contactName);
  const row = normalizeRow(found.row);

  row[0] = row[0] || nowDate();
  row[1] = "🟢 WHATSAPP";
  row[2] = userId;
  row[4] = contactName || row[4] || "";
  row[7] = userId;

  if (updates.nombre !== undefined) row[5] = updates.nombre;
  if (updates.plataforma !== undefined) row[6] = updates.plataforma;
  if (updates.pais !== undefined) row[8] = updates.pais;
  if (updates.estado !== undefined) row[9] = updates.estado;
  if (updates.primeraCarga !== undefined) row[10] = updates.primeraCarga;
  if (updates.fechaCarga !== undefined) row[11] = updates.fechaCarga;
  if (updates.primerRetiro !== undefined) row[12] = updates.primerRetiro;
  if (updates.fechaRetiro !== undefined) row[13] = updates.fechaRetiro;

  await saveRow(found.rowNumber, row);
  return row;
}

function mainMenu() {
  return `👑 Bienvenido a Red Corona Bett

Elegí una opción:

1️⃣ Crear Usuario
2️⃣ Cargar
3️⃣ Gané y quiero retirar
4️⃣ Hablar con un ADM
5️⃣ Canal Oficial
6️⃣ Beneficios

0️⃣ Menú`;
}

function platformMenu() {
  return `🎮 Elegí la plataforma:

1️⃣ Bet Space
2️⃣ Ganamosnet Org
3️⃣ Zeus

0️⃣ Menú`;
}

function getPlatform(text) {
  if (text === "1") return "💫 Bet Space";
  if (text === "2") return "🌟 Ganamosnet Org";
  if (text === "3") return "⚡️ Zeus";
  return null;
}

async function handleText(from, contactName, text) {
  const found = await getOrCreateUser(from, contactName);
  const row = normalizeRow(found.row);
  const estado = row[9] || "MENU";
  const lower = text.toLowerCase();

  if (lower === "hola" || lower === "menu" || lower === "menú" || text === "0") {
    await updateUser(from, contactName, { estado: "MENU" });
    await sendMetaEvent("BotStart", from, { source: "whatsapp" });
    await sendWhatsApp(from, mainMenu());
    return;
  }

  if (estado === "REG_NOMBRE") {
    await updateUser(from, contactName, {
      nombre: text,
      estado: "REG_PLATAFORMA"
    });
    await sendWhatsApp(from, platformMenu());
    return;
  }

  if (estado === "REG_PLATAFORMA") {
    const platform = getPlatform(text);
    if (!platform) {
      await sendWhatsApp(from, "Opción inválida.\n\n" + platformMenu());
      return;
    }

    const updated = await updateUser(from, contactName, {
      plataforma: platform,
      estado: "Registrado"
    });

    await sendMetaEvent("Lead", from, {
      source: "whatsapp",
      platform,
      status: "Registrado"
    });

    await sendMetaEvent("CompleteRegistration", from, {
      source: "whatsapp",
      platform,
      status: "Usuario creado"
    });

    await sendTelegram(`🚨 <b>NUEVO USUARIO WHATSAPP</b>

Origen: 🟢 WHATSAPP
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

👤 Nombre: ${updated[5]}
🎮 Plataforma: ${platform}

✅ Lead + CompleteRegistration enviados a Meta.

Para enviar usuario:
<code>/enviarusuario ${from} USUARIO CONTRASEÑA LINK</code>`);

    await sendWhatsApp(from, `✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

⏳ Te contactaremos a la brevedad.`);
    return;
  }

  if (estado === "CARGA_USUARIO") {
    await updateUser(from, contactName, {
      nombre: row[5] || contactName,
      estado: "CARGA_PLATAFORMA"
    });

    row[3] = text;
    await saveRow(found.rowNumber, row);

    await sendWhatsApp(from, platformMenu());
    return;
  }

  if (estado === "CARGA_PLATAFORMA") {
    const platform = getPlatform(text);
    if (!platform) {
      await sendWhatsApp(from, "Opción inválida.\n\n" + platformMenu());
      return;
    }

    await updateUser(from, contactName, {
      plataforma: platform,
      estado: "CARGA_MONTO"
    });

    await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuánto vas a cargar?");
    return;
  }

  if (estado === "CARGA_MONTO") {
    await updateUser(from, contactName, {
      primeraCarga: text,
      fechaCarga: nowDate(),
      estado: "ESPERANDO_COMPROBANTE"
    });

    await sendMetaEvent("InitiateCheckout", from, {
      source: "whatsapp",
      value: toNumber(text),
      currency: "ARS"
    });

    await sendWhatsApp(from, `💳 DATOS PARA CARGAR

🏦 Alias:
redcoronabet7

🔢 CVU:
000177500393009854128

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego enviá el comprobante por este mismo chat.`);
    return;
  }

  if (estado === "MENU" || estado === "Registrado" || estado === "Usuario enviado" || estado === "Cargó") {
    if (text === "1") {
      await updateUser(from, contactName, { estado: "REG_NOMBRE" });
      await sendMetaEvent("RegistroIniciado", from, { source: "whatsapp" });
      await sendWhatsApp(from, "👤 Perfecto.\n\n¿Cuál es tu nombre?");
      return;
    }

    if (text === "2") {
      await updateUser(from, contactName, { estado: "CARGA_USUARIO" });
      await sendMetaEvent("CargaIniciada", from, { source: "whatsapp" });
      await sendWhatsApp(from, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
      return;
    }

    if (text === "3") {
      await sendTelegram(`🥳💸 <b>SOLICITUD DE RETIRO WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}`);
      await sendWhatsApp(from, "✅ Un administrador fue notificado por tu retiro.");
      return;
    }

    if (text === "4") {
      await sendTelegram(`👨‍💼 <b>CLIENTE PIDE ADM WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}`);
      await sendWhatsApp(from, "👨‍💼 Un administrador fue notificado.\n\nTambién podés escribir por Telegram:\nhttps://t.me/Eliamcorona");
      return;
    }

    if (text === "5") {
      await sendWhatsApp(from, "📢 Canal Oficial:\n\nhttps://t.me/redcoronabet");
      return;
    }

    if (text === "6") {
      await sendWhatsApp(from, "🎁 Beneficios disponibles por el canal oficial:\n\nhttps://t.me/redcoronabet");
      return;
    }
  }

  await sendWhatsApp(from, mainMenu());
}

async function handleMedia(from, contactName) {
  const found = await getOrCreateUser(from, contactName);
  const row = normalizeRow(found.row);
  const amount = row[10] || "";

  await updateUser(from, contactName, {
    estado: "Comprobante recibido",
    fechaCarga: nowDate()
  });

  await sendMetaEvent("Purchase", from, {
    source: "whatsapp",
    value: toNumber(amount),
    currency: "ARS",
    status: "Comprobante recibido"
  });

  await sendTelegram(`📎 <b>COMPROBANTE RECIBIDO WHATSAPP</b>

Origen: 🟢 WHATSAPP
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}
Monto declarado: ${amount || "Sin monto"}

✅ Purchase enviado a Meta.

Para confirmar en Sheets:
<code>/cargo ${from} ${amount || "MONTO"}</code>`);

  await sendWhatsApp(from, "✅ Comprobante recibido.\n\nUn administrador lo revisará y confirmará tu carga.");
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

    if (!message) return res.status(200).send("EVENT_RECEIVED");

    const from = message.from;
    const contactName = value?.contacts?.[0]?.profile?.name || "Sin nombre";
    const text = message.text?.body?.trim() || "";

    if (message.image || message.document) {
      await handleMedia(from, contactName);
      return res.status(200).send("EVENT_RECEIVED");
    }

    if (text) {
      await handleText(from, contactName, text);
      return res.status(200).send("EVENT_RECEIVED");
    }

    await sendWhatsApp(from, mainMenu());
    return res.status(200).send("EVENT_RECEIVED");
  } catch (error) {
    console.error("Error WhatsApp:", error);
    return res.status(200).send("EVENT_RECEIVED");
  }
}
