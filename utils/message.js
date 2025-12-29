const { proto } = require("baileys");
const { logger } = require("./logger");

/**
 * @param {import('baileys').WAMessage} message
 * @returns {Object} mensagem formatada de forma mais amigável
 */
const getMessage = (message) => {
  try {
    return {
      key: message.key,
      messageTimestamp: message.messageTimestamp,
      pushName: message.pushName,
      content:
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text,
    };
  } catch (error) {
    logger.error(error);
  }
};

module.exports = { getMessage };
