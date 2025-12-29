const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  text: String,
  fromMe: Boolean, // true se veio do bot, false se veio do usuário
  timestamp: { type: Date, default: Date.now },
  messageId: String,
  status: {
    type: String,
    enum: ["pending", "sent", "delivered", "read"],
    default: "pending",
  },
  type: String, // "sticker" ou undefined para texto
  url: String, // URL da figurinha (caminho relativo /stickers/xxx.webp)
});

const conversationSchema = new mongoose.Schema({
  jid: { type: String, unique: true },
  name: String,
  img: String,
  area: Number,
  status: { type: String, default: "queue" },
  messages: [messageSchema],
});

module.exports = mongoose.model("Conversation", conversationSchema);
