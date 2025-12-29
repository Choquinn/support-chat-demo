const { WASocket } = require("baileys");

/**
 * @param {import('baileys').WASocket} bot
 * @param {Object} message
 */
const MessageHandler = async (bot, message) => {
  if (message.content === 'Oi!') {
    await bot.sendMessage(message.key.remoteJid, { text: 'Olá! Aqui quem fala é o bot!' });
  }
};

module.exports = MessageHandler;
