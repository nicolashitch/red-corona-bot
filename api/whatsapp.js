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
  if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
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
  const response = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
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
  });

  const data = await response.json();
  console.log("WhatsApp:", JSON.stringify(data, null, 2));
  return data;
}

async function sendTelegram(text, keyboard = null) {
  const body = {
    chat_id: ADMIN_ID,
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

async function sendMetaEvent(eventName, userId, customData = {}) {
  try {
    if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) {
      console.log("Meta omitido: faltan variables.");
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
          custom_data: eventName === "Purchase"
            ? { value: customData.value || 1, currency: customData.currency || "USD", ...customData }
            : customData
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
        { text: "❌ Rechazar", callback_data: `rechazar_${userId}` },
        { text: "✍️ Mensaje libre", callback_data: `mensaje_libre_${userId}` }
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
    requestBody: { values: [normalizeRow(row)] }
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

  if (updates.username !== undefined) row[3] = updates.username;
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
  return `👑🔥 RED CORONA BETT 🔥👑

⚡️ Bienvenido a la experiencia oficial ⚡️

• Elegí una opción para continuar

1️⃣ ♦️ CREAR USUARIO 🚀
2️⃣ ✅ REALIZAR CARGA ⚡️
3️⃣ 💳 SOLICITAR RETIRO 🥳
4️⃣ 🧌 HABLAR CON UN ADM 🧟‍♂️
5️⃣ 🌟 CANAL OFICIAL 📢
6️⃣ 🧞‍♂️ BENEFICIOS 🎁

⚡️ RESPONDÉ CON EL NÚMERO ⚡️

0️⃣ 🏆 MENÚ PRINCIPAL`;
}

function platformMenu() {
  return `🎮🔥 SELECCIONÁ TU PLATAFORMA 🔥🎮

1️⃣ 💫 BET SPACE
2️⃣ 🌟 GANAMOSNET ORG
3️⃣ ⚡ ZEUS

🚀 RESPONDÉ CON EL NÚMERO ELEGIDO 🚀

0️⃣ 🏆 MENÚ PRINCIPAL`;
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
      await sendWhatsApp(from, "⚠️🔥 Opción inválida 🔥⚠️\n\n" + platformMenu());
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

    await sendTelegram(
      `🚨 <b>NUEVO USUARIO WHATSAPP</b>

Origen: 🟢 WHATSAPP
ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

👤 Nombre: ${updated[5]}
🎮 Plataforma: ${platform}

✅ Lead enviado a Meta.

Para enviar usuario:
<code>/enviarusuario ${from} USUARIO CONTRASEÑA LINK</code>`,
      adminButtons(from)
    );

    await sendWhatsApp(from, `🔥✅ SOLICITUD RECIBIDA ✅🔥

⚡️ Tu acceso está siendo preparado por un administrador ⚡️

💳🔥 DATOS PARA CARGAR 🔥💳

🏦 Alias:
betcorona7

🔢 CVU:
0000003100085480169920

👤 Titular:
Elias Nicolas Palet

📎 Luego de transferir, enviá el comprobante por este mismo chat.

⏳⚡️ Un administrador revisará la acreditación y te confirmará cuando esté impactada ⚡️`);
    return;
  }

  if (estado === "CARGA_USUARIO") {
    await updateUser(from, contactName, {
      username: text,
      estado: "CARGA_PLATAFORMA"
    });

    await sendWhatsApp(from, platformMenu());
    return;
  }

  if (estado === "CARGA_PLATAFORMA") {
    const platform = getPlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "⚠️🔥 Opción inválida 🔥⚠️\n\n" + platformMenu());
      return;
    }

    await updateUser(from, contactName, {
      plataforma: platform,
      estado: "CARGA_MONTO"
    });

    await sendWhatsApp(from, `💳🔥 PERFECTO 🔥💳

⚡️ ¿Cuánto vas a cargar?

🚀 Respondé solo con el monto.`);
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

    await sendTelegram(
      `💳 <b>CARGA INICIADA WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}
Usuario: ${row[3] || ""}
Monto declarado: ${text}

✅ InitiateCheckout enviado a Meta.

Esperando comprobante.`,
      adminButtons(from)
    );

    await sendWhatsApp(from, `💳🔥 DATOS PARA CARGAR 🔥💳

🏦 Alias:
bedcoronabet7

🔢 CVU:
0000003100085480169920

👤 Titular:
Palet Elias Nicolas

📎 Luego enviá el comprobante por este mismo chat.

⚡️ Apenas lo recibamos, seguimos con la revisión.`);
    return;
  }

  if (estado === "Retiro solicitado") {
    await updateUser(from, contactName, {
      estado: "RETIRO_TITULAR",
      primerRetiro: `${row[12] || ""}\nCVU/CBU: ${text}`
    });

    await sendWhatsApp(from, `✅🔥 PERFECTO 🔥✅

⚡️ Ahora enviame el titular de la cuenta.`);
    return;
  }

  if (estado === "RETIRO_TITULAR") {
    await updateUser(from, contactName, {
      estado: "RETIRO_BANCO",
      primerRetiro: `${row[12] || ""}\nTitular: ${text}`
    });

    await sendWhatsApp(from, `🏦⚡️ BIEN ⚡️🏦

🔥 Ahora enviame el banco o billetera.`);
    return;
  }

  if (estado === "RETIRO_BANCO") {
    const updated = await updateUser(from, contactName, {
      estado: "RETIRO_DATOS_RECIBIDOS",
      primerRetiro: `${row[12] || ""}\nBanco/Billetera: ${text}`
    });

    await sendTelegram(
      `💸 <b>DATOS PARA ACREDITAR RETIRO WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

${updated[12] || ""}

Cuando pagues, usá:
<code>/comprobantepago ${from}</code>`,
      adminButtons(from)
    );

    await sendWhatsApp(from, `✅🔥 DATOS RECIBIDOS 🔥✅

⚡️ Un administrador realizará la acreditación.

👑 Te avisaremos por este mismo chat.`);
    return;
  }

  if (estado === "MENU" || estado === "Registrado" || estado === "Usuario enviado" || estado === "Cargó" || estado === "Comprobante recibido") {
    if (text === "1") {
      await updateUser(from, contactName, { estado: "REG_NOMBRE" });
      await sendMetaEvent("RegistroIniciado", from, { source: "whatsapp" });
      await sendWhatsApp(from, `👤🔥 PERFECTO 🔥👤

⚡️ ¿Cuál es tu nombre?

🚀 Enviámelo para continuar.`);
      return;
    }

    if (text === "2") {
      await updateUser(from, contactName, { estado: "CARGA_USUARIO" });
      await sendMetaEvent("CargaIniciada", from, { source: "whatsapp" });
      await sendWhatsApp(from, `💳🔥 VAMOS CON TU CARGA 🔥💳

⚡️ ¿Cuál es tu usuario?

🚀 Escribilo tal cual aparece en la plataforma.`);
      return;
    }

    if (text === "3") {
      await updateUser(from, contactName, { estado: "RETIRO_USUARIO" });
      await sendWhatsApp(from, `🥳💳 RETIRO EN MARCHA 💳🥳

⚡️ ¿Cuál es tu usuario?

🚀 Enviámelo para continuar.`);
      return;
    }

    if (text === "4") {
      await sendTelegram(`👨‍💼 <b>CLIENTE PIDE ADM WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}`, adminButtons(from));

      await sendWhatsApp(from, `👨‍💼🔥 ADM NOTIFICADO 🔥👨‍💼

⚡️ Un administrador fue notificado.

También podés escribir por Telegram:
https://t.me/Eliamcorona`);
      return;
    }

    if (text === "5") {
      await sendWhatsApp(from, `📢🌟 CANAL OFICIAL 🌟📢

⚡️ Entrá desde acá:

https://t.me/redcoronabet`);
      return;
    }

    if (text === "6") {
      await sendWhatsApp(from, `🎁🧞‍♂️ BENEFICIOS DISPONIBLES 🧞‍♂️🎁

⚡️ Los beneficios activos se informan por el canal oficial:

https://t.me/redcoronabet`);
      return;
    }
  }

  if (estado === "RETIRO_USUARIO") {
    await updateUser(from, contactName, {
      username: text,
      estado: "RETIRO_PLATAFORMA"
    });

    await sendWhatsApp(from, platformMenu());
    return;
  }

  if (estado === "RETIRO_PLATAFORMA") {
    const platform = getPlatform(text);

    if (!platform) {
      await sendWhatsApp(from, "⚠️🔥 Opción inválida 🔥⚠️\n\n" + platformMenu());
      return;
    }

    await updateUser(from, contactName, {
      plataforma: platform,
      estado: "RETIRO_MONTO"
    });

    await sendWhatsApp(from, `💳🔥 PERFECTO 🔥💳

⚡️ ¿Cuánto querés retirar?

🚀 Enviá el monto para continuar.`);
    return;
  }

  if (estado === "RETIRO_MONTO") {
    const updated = await updateUser(from, contactName, {
      primerRetiro: text,
      fechaRetiro: nowDate(),
      estado: "RETIRO_SOLICITADO"
    });

    await sendTelegram(
      `🥳💸 <b>SOLICITUD DE RETIRO WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}

👤 Usuario: ${updated[3] || ""}
🎮 Plataforma: ${updated[6] || ""}
💰 Monto: ${text}

Cuando retires las fichas, usá el botón o:
<code>/retiroconfirmado ${from}</code>`,
      adminButtons(from)
    );

    await sendWhatsApp(from, `✅🔥 SOLICITUD RECIBIDA 🔥✅

⚡️ Un administrador revisará tu usuario, monto y plataforma.

👑 Te confirmaremos por este chat.`);
    return;
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

  await sendTelegram(
    `📎 <b>COMPROBANTE RECIBIDO WHATSAPP</b>

ID: <code>${from}</code>
Nombre WhatsApp: ${contactName}
Usuario: ${row[3] || ""}
Plataforma: ${row[6] || ""}
Monto declarado: ${amount || "Sin monto"}

Para confirmar carga:
<code>/cargo ${from} ${amount || "MONTO"}</code>`,
    adminButtons(from)
  );

  await sendWhatsApp(from, `📎🔥 COMPROBANTE RECIBIDO 🔥📎

⚡️ Un administrador lo revisará y confirmará tu carga.

🚀 Te avisaremos por este mismo chat.`);
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
