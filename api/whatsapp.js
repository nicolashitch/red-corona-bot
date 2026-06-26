const ADMIN_PHONE = process.env.ADMIN_PHONE || "5490000000000";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "red_corona_verify";

const sessions = {};

async function sendMessage(to, text) {
  await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });
}

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function mainMenuText() {
  return (
`👑 Bienvenido a Red Corona Bett

Seleccioná una opción respondiendo con el número:

1️⃣ Crear Usuario
2️⃣ Cargar
3️⃣ Retirar
4️⃣ Hablar con un ADM
5️⃣ Canal Oficial
6️⃣ Beneficios

También podés escribir:
menu / volver / inicio`
  );
}

function platformMenuText() {
  return (
`🎮 Elegí la plataforma respondiendo con el número:

1️⃣ Bet Space
2️⃣ Ganamosnet Org
3️⃣ Zeus Multi

0️⃣ Volver`
  );
}

function afterRegisterMenuText() {
  return (
`✅ Solicitud recibida.

Tu acceso está siendo preparado por un administrador.

Mientras tanto podés elegir:

1️⃣ Canal Oficial
2️⃣ Reclamar Beneficios
3️⃣ Acceso VIP
4️⃣ Cargar
5️⃣ Retirar
0️⃣ Volver`
  );
}

function bonusesMenuText() {
  return (
`🎁 Beneficios disponibles:

1️⃣ Bono de Bienvenida
2️⃣ Recomendación
3️⃣ Fidelidad

0️⃣ Volver`
  );
}

function getPlatformFromText(text) {
  const t = text.toLowerCase().trim();

  if (t === "1" || t.includes("bet space")) return "Bet Space";
  if (t === "2" || t.includes("ganamos")) return "Ganamosnet Org";
  if (t === "3" || t.includes("zeus")) return "Zeus Multi";

  return null;
}

function isBack(text) {
  const t = text.toLowerCase().trim();
  return t === "0" || t === "volver" || t === "menu" || t === "inicio";
}

function isAdmin(phone) {
  return cleanPhone(phone) === cleanPhone(ADMIN_PHONE);
}

async function notifyAdmin(text) {
  await sendMessage(ADMIN_PHONE, text);
}

async function handleAdminCommand(from, text) {
  const parts = text.trim().split(" ");
  const command = parts[0].toLowerCase();

  if (command === "/enviarusuario") {
    if (parts.length < 5) {
      await sendMessage(
        from,
`Formato incorrecto.

Usá:
/enviarusuario NUMERO USUARIO CONTRASEÑA LINK

Ejemplo:
/enviarusuario 5491122334455 juan123 clave123 https://link.com`
      );
      return true;
    }

    const userPhone = cleanPhone(parts[1]);
    const user = parts[2];
    const pass = parts[3];
    const link = parts.slice(4).join(" ");

    await sendMessage(
      userPhone,
`✅ Tu acceso ya está listo

👤 Usuario: ${user}
🔐 Contraseña: ${pass}
🔗 Link: ${link}

Cuando realices tu carga, enviá el comprobante por este mismo WhatsApp.`
    );

    await sendMessage(from, "✅ Usuario enviado correctamente.");
    return true;
  }

  if (command === "/confirmarcarga") {
    if (parts.length < 2) {
      await sendMessage(
        from,
`Formato incorrecto.

Usá:
/confirmarcarga NUMERO`
      );
      return true;
    }

    const userPhone = cleanPhone(parts[1]);

    await sendMessage(
      userPhone,
`✅ Tu carga fue confirmada.

Fichas cargadas correctamente.

Muchas gracias.`
    );

    await sendMessage(from, "✅ Confirmación enviada al usuario.");
    return true;
  }

  if (command === "/retirorealizado") {
    if (parts.length < 2) {
      await sendMessage(
        from,
`Formato incorrecto.

Usá:
/retirorealizado NUMERO`
      );
      return true;
    }

    const userPhone = cleanPhone(parts[1]);
    sessions[userPhone] = { step: "withdraw_cvu" };

    await sendMessage(
      userPhone,
`✅ Ya retiramos las fichas de la plataforma.

Ahora enviame tu CVU/CBU para acreditar.`
    );

    await sendMessage(from, "✅ Se solicitó CVU/CBU al usuario.");
    return true;
  }

  if (command === "/retiroconfirmado") {
    if (parts.length < 2) {
      await sendMessage(
        from,
`Formato incorrecto.

Usá:
/retiroconfirmado NUMERO`
      );
      return true;
    }

    const userPhone = cleanPhone(parts[1]);

    await sendMessage(
      userPhone,
`✅ Retiro confirmado.

La acreditación fue realizada correctamente.

Muchas gracias.`
    );

    await sendMessage(from, "✅ Retiro confirmado al usuario.");
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Verification failed");
  }

  if (req.method !== "POST") {
    return res.status(200).send("Red Corona WhatsApp Bot Online");
  }

  const body = req.body;

  const message =
    body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  const contact =
    body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

  if (!message) {
    return res.status(200).json({ ok: true });
  }

  const from = cleanPhone(message.from);
  const profileName = contact?.profile?.name || "Sin nombre";
  const messageType = message.type;
  const text =
    message?.text?.body?.trim() ||
    message?.button?.text?.trim() ||
    "";

  if (isAdmin(from)) {
    const handled = await handleAdminCommand(from, text);
    if (handled) return res.status(200).json({ ok: true });
  }

  if (messageType === "image" || messageType === "document") {
    await notifyAdmin(
`📎 COMPROBANTE / ARCHIVO RECIBIDO

WhatsApp: ${from}
Nombre: ${profileName}
Tipo: ${messageType}

Para confirmar la carga usá:
/confirmarcarga ${from}`
    );

    await sendMessage(
      from,
`✅ Comprobante recibido.

Un administrador lo revisará y acreditará tu carga a la brevedad.`
    );

    return res.status(200).json({ ok: true });
  }

  if (!text) {
    await sendMessage(from, mainMenuText());
    return res.status(200).json({ ok: true });
  }

  const lower = text.toLowerCase();

  if (
    lower === "hola" ||
    lower === "menu" ||
    lower === "menú" ||
    lower === "inicio" ||
    lower === "/start" ||
    lower === "volver" ||
    text === "0"
  ) {
    sessions[from] = {};

    await notifyAdmin(
`👀 BOT WHATSAPP START

WhatsApp: ${from}
Nombre: ${profileName}`
    );

    await sendMessage(from, mainMenuText());
    return res.status(200).json({ ok: true });
  }

  const session = sessions[from] || {};

  if (!session.step) {
    if (text === "1" || lower.includes("crear")) {
      sessions[from] = { step: "name" };

      await notifyAdmin(
`🎮 REGISTRO INICIADO

WhatsApp: ${from}
Nombre: ${profileName}`
      );

      await sendMessage(
        from,
`Perfecto ✅

¿Cuál es tu nombre?`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "2" || lower.includes("cargar")) {
      sessions[from] = { step: "load_user" };

      await sendMessage(
        from,
`💳 Perfecto.

¿Cuál es tu usuario?`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "3" || lower.includes("retirar") || lower.includes("retiro")) {
      sessions[from] = { step: "withdraw_user" };

      await sendMessage(
        from,
`🥳 Perfecto.

¿Cuál es tu usuario?`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "4" || lower.includes("admin") || lower.includes("adm")) {
      await sendMessage(
        from,
`👨‍💼 Podés hablar con un administrador acá:

https://wa.me/${ADMIN_PHONE}`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "5" || lower.includes("canal")) {
      await sendMessage(
        from,
`📢 Canal Oficial

Unite desde acá:
https://t.me/redcoronabet`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "6" || lower.includes("beneficio") || lower.includes("bono")) {
      sessions[from] = { step: "benefits_menu" };

      await sendMessage(from, bonusesMenuText());
      return res.status(200).json({ ok: true });
    }
        await sendMessage(from, mainMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "benefits_menu") {
    if (isBack(text)) {
      sessions[from] = {};
      await sendMessage(from, mainMenuText());
      return res.status(200).json({ ok: true });
    }

    if (text === "1" || lower.includes("bienvenida")) {
      await sendMessage(
        from,
`🎉 Bono de Bienvenida

Una vez que tu usuario esté habilitado podés solicitar este beneficio.`
      );

      await sendMessage(from, bonusesMenuText());
      return res.status(200).json({ ok: true });
    }

    if (text === "2" || lower.includes("recomend")) {
      await sendMessage(
        from,
`🤝 Recomendación

Enviá una captura donde nos recomendaste y/o etiquetaste.

Plataformas válidas:

✅ Estados de WhatsApp
✅ Facebook

Etiqueta:
@redcoronabetadm
@nicolasmaximocorona

Luego enviá la captura por este mismo WhatsApp.`
      );

      await notifyAdmin(
`🤝 SOLICITUD RECOMENDACIÓN

WhatsApp: ${from}
Nombre: ${profileName}`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "3" || lower.includes("fidelidad")) {
      await sendMessage(
        from,
`💎 Fidelidad

Luego de que tu recomendado realice su primera carga, ambos pueden solicitar el beneficio especial.

Tu solicitud fue enviada a un administrador.`
      );

      await notifyAdmin(
`💎 SOLICITUD FIDELIDAD

WhatsApp: ${from}
Nombre: ${profileName}`
      );

      return res.status(200).json({ ok: true });
    }

    await sendMessage(from, bonusesMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "name") {
    session.name = text;
    session.step = "platform";
    sessions[from] = session;

    await sendMessage(from, platformMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "platform") {
    if (isBack(text)) {
      sessions[from] = {};
      await sendMessage(from, mainMenuText());
      return res.status(200).json({ ok: true });
    }

    const platform = getPlatformFromText(text);

    if (!platform) {
      await sendMessage(from, platformMenuText());
      return res.status(200).json({ ok: true });
    }

    session.platform = platform;
    session.step = "phone";
    sessions[from] = session;

    await sendMessage(
      from,
`Ahora enviame tu teléfono de contacto:`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "phone") {
    session.phone = text;
    session.step = "country";
    sessions[from] = session;

    await sendMessage(
      from,
`¿De qué país sos?`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "country") {
    session.country = text;
    session.step = "done";
    sessions[from] = session;

    await notifyAdmin(
`🚨 NUEVA SOLICITUD DE USUARIO

👤 Nombre: ${session.name}
🎮 Plataforma: ${session.platform}
📞 Teléfono: ${session.phone}
🌍 País: ${session.country}

WhatsApp:
Número: ${from}
Nombre WhatsApp: ${profileName}

Para enviar el usuario usá:
/enviarusuario ${from} USUARIO CONTRASEÑA LINK`
    );

    await sendMessage(from, afterRegisterMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "done") {
    if (isBack(text)) {
      sessions[from] = {};
      await sendMessage(from, mainMenuText());
      return res.status(200).json({ ok: true });
    }

    if (text === "1" || lower.includes("canal")) {
      await sendMessage(
        from,
`📢 Canal Oficial

Unite desde acá:
https://t.me/redcoronabet`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "2" || lower.includes("beneficio") || lower.includes("bono")) {
      sessions[from] = { step: "benefits_menu" };
      await sendMessage(from, bonusesMenuText());
      return res.status(200).json({ ok: true });
    }

    if (text === "3" || lower.includes("vip")) {
      await notifyAdmin(
`⭐ SOLICITUD VIP

WhatsApp: ${from}
Nombre: ${profileName}`
      );

      await sendMessage(
        from,
`⭐ Acceso VIP

Los usuarios VIP reciben atención prioritaria, beneficios exclusivos y acceso a un canal privado.

Requisito: actividad superior a $100.000.

Tu solicitud fue enviada a un administrador.`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "4" || lower.includes("cargar")) {
      sessions[from] = { step: "load_user" };

      await sendMessage(
        from,
`💳 Perfecto.

¿Cuál es tu usuario?`
      );

      return res.status(200).json({ ok: true });
    }

    if (text === "5" || lower.includes("retirar") || lower.includes("retiro")) {
      sessions[from] = { step: "withdraw_user" };

      await sendMessage(
        from,
`🥳 Perfecto.

¿Cuál es tu usuario?`
      );

      return res.status(200).json({ ok: true });
    }

    await sendMessage(from, afterRegisterMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "load_user") {
    session.loadUser = text;
    session.step = "load_platform";
    sessions[from] = session;

    await sendMessage(from, platformMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "load_platform") {
    if (isBack(text)) {
      sessions[from] = {};
      await sendMessage(from, mainMenuText());
      return res.status(200).json({ ok: true });
    }

    const platform = getPlatformFromText(text);

    if (!platform) {
      await sendMessage(from, platformMenuText());
      return res.status(200).json({ ok: true });
    }

    session.loadPlatform = platform;
    session.step = "waiting_receipt";
    sessions[from] = session;

    await notifyAdmin(
`💳 SOLICITUD DE CARGA

👤 Usuario: ${session.loadUser}
🎮 Plataforma: ${session.loadPlatform}

WhatsApp:
Número: ${from}
Nombre WhatsApp: ${profileName}

Cuando llegue el comprobante, confirmá con:
/confirmarcarga ${from}`
    );

    await sendMessage(
      from,
`💳 Datos para cargar

🏦 Alias:
redcoronabet7

🔢 CVU:
000177500393009854128

👤 Titular:
Sonia Raquel Gutierrez

✅ Luego de transferir, enviá el comprobante por este mismo WhatsApp.

⏳ Un administrador revisará la acreditación y te confirmará cuando esté impactada.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "waiting_receipt") {
    await sendMessage(
      from,
`✅ Estoy esperando el comprobante.

Enviá la imagen o archivo por este mismo WhatsApp.

También podés escribir "menu" para volver al inicio.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_user") {
    session.withdrawUser = text;
    session.step = "withdraw_platform";
    sessions[from] = session;

    await sendMessage(from, platformMenuText());
    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_platform") {
    if (isBack(text)) {
      sessions[from] = {};
      await sendMessage(from, mainMenuText());
      return res.status(200).json({ ok: true });
    }

    const platform = getPlatformFromText(text);

    if (!platform) {
      await sendMessage(from, platformMenuText());
      return res.status(200).json({ ok: true });
    }

    session.withdrawPlatform = platform;
    session.step = "withdraw_amount";
    sessions[from] = session;

    await sendMessage(
      from,
`Perfecto ✅

¿Cuánto querés retirar?`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_amount") {
    session.withdrawAmount = text;
    session.step = "withdraw_waiting_admin";
    sessions[from] = session;

    await notifyAdmin(
`🥳 SOLICITUD DE RETIRO

👤 Usuario: ${session.withdrawUser}
💰 Monto: ${session.withdrawAmount}
🎮 Plataforma: ${session.withdrawPlatform}

WhatsApp:
Número: ${from}
Nombre WhatsApp: ${profileName}

Cuando retires las fichas, usá:
/retirorealizado ${from}`
    );

    await sendMessage(
      from,
`✅ Solicitud recibida.

Un administrador revisará tu usuario, monto y plataforma.

Cuando esté listo, te vamos a pedir los datos de acreditación.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_waiting_admin") {
    await sendMessage(
      from,
`⏳ Tu solicitud ya fue enviada.

Un administrador la está revisando.

Cuando esté lista, te vamos a pedir los datos de acreditación.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_cvu") {
    session.withdrawCvu = text;
    session.step = "withdraw_holder";
    sessions[from] = session;

    await sendMessage(
      from,
`Perfecto ✅

Ahora enviame el titular de la cuenta.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_holder") {
    session.withdrawHolder = text;
    session.step = "withdraw_bank";
    sessions[from] = session;

    await sendMessage(
      from,
`Bien ✅

Ahora enviame el nombre del banco o billetera.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_bank") {
    session.withdrawBank = text;
    session.step = "withdraw_done";
    sessions[from] = session;

    await notifyAdmin(
`💸 DATOS PARA ACREDITAR RETIRO

CVU/CBU: ${session.withdrawCvu}
Titular: ${session.withdrawHolder}
Banco/Billetera: ${session.withdrawBank}

WhatsApp:
Número: ${from}
Nombre WhatsApp: ${profileName}

Cuando acredites, confirmá con:
/retiroconfirmado ${from}`
    );

    await sendMessage(
      from,
`✅ Datos recibidos.

Un administrador realizará la acreditación y te enviará el comprobante por este WhatsApp.`
    );

    return res.status(200).json({ ok: true });
  }

  if (session.step === "withdraw_done") {
    await sendMessage(
      from,
`✅ Tus datos ya fueron recibidos.

Un administrador te avisará cuando la acreditación esté realizada.`
    );

    return res.status(200).json({ ok: true });
  }

  sessions[from] = {};
  await sendMessage(from, mainMenuText());
  return res.status(200).json({ ok: true });
}
