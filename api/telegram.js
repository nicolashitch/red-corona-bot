const ADMIN_ID = "8291674623";

const sessions = {};

async function sendMessage(chatId, text, keyboard = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = keyboard;
  }

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function mainMenu() {
  return {
    keyboard: [
      ["🎮 Crear Usuario"],
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Red Corona Bot Online");
  }

  const update = req.body;

  if (!update.message) {
    return res.status(200).json({ ok: true });
  }

  const chatId = update.message.chat.id;
  const text = update.message.text || "";
  const username = update.message.from?.username || "Sin username";
  const firstName = update.message.from?.first_name || "";
  const lastName = update.message.from?.last_name || "";

  if (text === "/start" || text === "⬅️ Volver") {
    await sendMessage(
  ADMIN_ID,
  `👀 <b>BOT START</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`
);
    sessions[chatId] = {};
    await sendMessage(
      chatId,
      "👑 <b>Bienvenido a Red Corona Bett</b>\n\nSelecciona una opción:",
      mainMenu()
    );
    return res.status(200).json({ ok: true });
  }

  if (text === "🎮 Crear Usuario" || text === "/registro") {
    await sendMessage(
  ADMIN_ID,
  `🎮 <b>REGISTRO INICIADO</b>\n\nID: ${chatId}\nUsername: @${username}\nNombre: ${firstName} ${lastName}`
);
    sessions[chatId] = { step: "name" };
    await sendMessage(chatId, "Perfecto ✅\n\n¿Cuál es tu nombre?");
    return res.status(200).json({ ok: true });
  }

  if (text === "👨‍💼 Hablar con un ADM" || text === "/admin") {
    await sendMessage(chatId, "Podés hablar con un administrador acá:\n\nhttps://t.me/Eliamcorona");
    return res.status(200).json({ ok: true });
  }

  if (text === "📢 Canal Oficial" || text === "/canal") {
    await sendMessage(chatId, "Canal oficial:\n\nPegá acá el link de tu canal cuando lo tengas listo.");
    return res.status(200).json({ ok: true });
  }

  if (text === "🎁 Beneficios" || text === "/beneficios") {
    await sendMessage(
      chatId,
      "🎁 <b>Beneficios Red Corona Bett</b>\n\n✅ Atención personalizada\n✅ Acceso rápido\n✅ Canal privado\n✅ Soporte disponible"
    );
    return res.status(200).json({ ok: true });
  }

  const session = sessions[chatId] || {};

  if (session.step === "name") {
    session.name = text;
    session.step = "platform";
    sessions[chatId] = session;

    await sendMessage(
      chatId,
      "Perfecto. Ahora elegí la plataforma:",
      platformMenu()
    );
    return res.status(200).json({ ok: true });
  }

  if (session.step === "platform") {
    const platforms = ["Bet Space", "Ganamosnet Org", "Zeus (multi)"];

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

    await sendMessage(ADMIN_ID, adminMessage);

    await sendMessage(
      chatId,
      "✅ Solicitud recibida.\n\nUn administrador va a preparar tu acceso y te contactará por este chat.",
      mainMenu()
    );

    return res.status(200).json({ ok: true });
  }

  await sendMessage(
    chatId,
    "Seleccioná una opción del menú:",
    mainMenu()
  );

  return res.status(200).json({ ok: true });
}
