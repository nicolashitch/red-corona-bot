const ADMIN_ID = "8291674623";

const sessions = {};

async function sendMessage(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
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

    if (data.startsWith("confirmar_carga_")) {
      const userId = data.replace("confirmar_carga_", "");

      await sendMessage(
        userId,
        "✅ Tu carga fue confirmada.\n\nFichas cargadas correctamente.\n\nMuchas gracias."
      );

      await sendMessage(adminChatId, "✅ Confirmación enviada al usuario.");
      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("enviar_usuario_")) {
      const userId = data.replace("enviar_usuario_", "");

      await sendMessage(
        adminChatId,
        `📩 Para enviar el usuario, copiá y usá este formato:\n\n/enviarusuario ${userId} USUARIO CONTRASEÑA LINK`
      );

      return res.status(200).json({ ok: true });
    }

    if (data.startsWith("retiro_realizado_")) {
      const userId = data.replace("retiro_realizado_", "");

      sessions[userId] = { step: "withdraw_cvu" };

      await sendMessage(
        userId,
        "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar."
      );

      await sendMessage(adminChatId, "✅ Se solicitó CVU/CBU al usuario.");
      return res.status(200).json({ ok: true });
    }
    if (data.startsWith("pago_enviado_")) {
  const userId = data.replace("pago_enviado_", "");

  await sendMessage(
    userId,
    "✅ Pago enviado.\n\nTu retiro fue acreditado correctamente.\n\nMuchas gracias."
  );

  await sendMessage(
    adminChatId,
    "✅ Aviso de pago enviado al usuario."
  );

  return res.status(200).json({ ok: true });
}
  }

  if (!update.message) {
    return res.status(200).json({ ok: true });
  }

  const chatId = update.message.chat.id;
  const text = update.message.text || "";
  const username = update.message.from?.username || "Sin username";
  const firstName = update.message.from?.first_name || "";
  const lastName = update.message.from?.last_name || "";

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

    await sendMessage(
      userId,
      `✅ <b>Tu acceso ya está listo</b>\n\n👤 Usuario: ${user}\n🔐 Contraseña: ${pass}\n🔗 Link: ${link}\n\nCuando realices tu carga, enviá el comprobante por este mismo chat.`
    );

    await sendMessage(ADMIN_ID, "✅ Usuario enviado correctamente.");
    return res.status(200).json({ ok: true });
  }

  if (text.startsWith("/retiroconfirmado") && String(chatId) === ADMIN_ID) {
    const parts = text.split(" ");

    if (parts.length < 2) {
      await sendMessage(ADMIN_ID, "Formato incorrecto.\n\nUsá:\n/retiroconfirmado ID");
      return res.status(200).json({ ok: true });
    }

    const userId = parts[1];
    sessions[userId] = { step: "withdraw_cvu" };

    await sendMessage(
      userId,
      "✅ Ya retiramos las fichas de la plataforma.\n\nAhora enviame tu CVU/CBU para acreditar."
    );

    await sendMessage(ADMIN_ID, "✅ Se solicitó CVU/CBU al usuario.");
    return res.status(200).json({ ok: true });
  }

  if (update.message.photo || update.message.document) {
    await sendMessage(
      ADMIN_ID,
      `📎 <b>COMPROBANTE RECIBIDO</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`,
      {
        inline_keyboard: [[{ text: "✅ Confirmar carga", callback_data: `confirmar_carga_${chatId}` }]]
      }
    );

    await sendMessage(chatId, "✅ Comprobante recibido.\n\nUn administrador lo revisará y acreditará tu carga a la brevedad.");
    return res.status(200).json({ ok: true });
  }

  if (text === "/start" || text === "⬅️ Volver") {
    await sendMessage(ADMIN_ID, `👀 <b>BOT START</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`);
    sessions[chatId] = {};
    await sendMessage(chatId, "👑 <b>Bienvenido a Red Corona Bett</b>\n\nSelecciona una opción:", mainMenu());
    return res.status(200).json({ ok: true });
  }

  if (text === "🎮 Crear Usuario" || text === "/registro") {
    await sendMessage(ADMIN_ID, `🎮 <b>REGISTRO INICIADO</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`);
    sessions[chatId] = { step: "name" };
    await sendMessage(chatId, "Perfecto ✅\n\n¿Cuál es tu nombre?");
    return res.status(200).json({ ok: true });
  }

  if (text === "💳 Cargar") {
    sessions[chatId] = { step: "load_user" };
    await sendMessage(chatId, "💳 Perfecto.\n\n¿Cuál es tu usuario?");
    return res.status(200).json({ ok: true });
  }

  if (text === "🥳💸 Gané y quiero retirar") {
    sessions[chatId] = { step: "withdraw_user" };
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
    await sendMessage(ADMIN_ID, `🤝 <b>SOLICITUD RECOMENDACIÓN</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`);
    return res.status(200).json({ ok: true });
  }

  if (text === "💎 Fidelidad") {
    await sendMessage(chatId, "💎 Fidelidad\n\nLuego de que tu recomendado realice su primera carga, ambos reciben su bono especial 🥳💸🎁💰\n\n♦️ Reclama el tuyo ahora.", bonusesMenu());
    await sendMessage(ADMIN_ID, `💎 <b>SOLICITUD FIDELIDAD</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`);
    return res.status(200).json({ ok: true });
  }

  if (text === "⭐ Acceso VIP") {
    await sendMessage(ADMIN_ID, `⭐ <b>SOLICITUD VIP</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`);
    await sendMessage(chatId, "⭐ <b>Acceso VIP</b>\n\nLos usuarios VIP reciben atención prioritaria, beneficios exclusivos y acceso a un canal privado.\n\nRequisito: actividad superior a $100.000.\n\nTu solicitud fue enviada a un administrador.", afterRegisterMenu());
    return res.status(200).json({ ok: true });
  }

  const session = sessions[chatId] || {};

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

    await sendMessage(
      ADMIN_ID,
      `🥳💸 <b>SOLICITUD DE RETIRO</b>\n\n` +
      `👤 Usuario: ${session.withdrawUser}\n` +
      `💰 Monto: ${session.withdrawAmount}\n` +
      `🎮 Plataforma: ${session.withdrawPlatform}\n\n` +
      `Telegram:\n` +
      `ID: ${chatId}\n` +
      `Username: @${username}\n` +
      `Nombre Telegram: ${firstName} ${lastName}\n\n` +
      `Cuando retires las fichas, tocá el botón de abajo.`,
      {
        inline_keyboard: [[{ text: "💸 Retiro realizado", callback_data: `retiro_realizado_${chatId}` }]]
      }
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
      `💸 <b>DATOS PARA ACREDITAR RETIRO</b>\n\nCVU/CBU: ${session.withdrawCvu}\nTitular: ${session.withdrawHolder}\nBanco/Billetera: ${session.withdrawBank}\n\nTelegram:\nID: ${chatId}\nUsername: @${username}\nNombre Telegram: ${firstName} ${lastName}`
    );

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

    await sendMessage(ADMIN_ID, `💳 <b>SOLICITUD DE CARGA</b>\n\n👤 Usuario: ${session.loadUser}\n🎮 Plataforma: ${session.loadPlatform}\n\nTelegram:\nID: ${chatId}\nUsername: @${username}\nNombre Telegram: ${firstName} ${lastName}`);

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
      `🚨 <b>NUEVA SOLICITUD DE USUARIO</b>\n\n` +
      `👤 Nombre: ${session.name}\n` +
      `🎮 Plataforma: ${session.platform}\n` +
      `📞 Teléfono: ${session.phone}\n` +
      `🌍 País: ${session.country}\n\n` +
      `Telegram:\n` +
      `ID: ${chatId}\n` +
      `Username: @${username}\n` +
      `Nombre Telegram: ${firstName} ${lastName}`;

    await sendMessage(
      ADMIN_ID,
      adminMessage,
      {
        inline_keyboard: [[{ text: "📩 Enviar usuario", callback_data: `enviar_usuario_${chatId}` }]]
      }
    );

    await sendMessage(chatId, "✅ Solicitud recibida.\n\nTu acceso está siendo preparado por un administrador.\n\nMientras tanto podés unirte al canal oficial, reclamar beneficios o solicitar acceso VIP.", afterRegisterMenu());
    return res.status(200).json({ ok: true });
  }

  await sendMessage(chatId, "Seleccioná una opción del menú:", mainMenu());
  return res.status(200).json({ ok: true });
}
