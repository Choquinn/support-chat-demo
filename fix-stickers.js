require("dotenv").config();
const mongoose = require("mongoose");
const Conversation = require("./models/Conversation");
const path = require("path");
const fs = require("fs");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/secure-login";
const STICKER_DIR = path.join(__dirname, "public", "stickers");

async function fixStickerUrls() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB conectado");

    const conversations = await Conversation.find({
      "messages.type": "sticker",
    });

    console.log(
      `\n📋 Encontradas ${conversations.length} conversas com stickers`
    );

    let fixed = 0;
    let notFound = 0;
    let alreadyFixed = 0;

    for (const conv of conversations) {
      let modified = false;

      for (const msg of conv.messages) {
        if (msg.type === "sticker") {
          // Se já tem URL válida, pula
          if (msg.url && msg.url.startsWith("/stickers/")) {
            alreadyFixed++;
            continue;
          }

          // Tenta encontrar o arquivo do sticker
          const stickerFileName = `${msg.messageId}.webp`;
          const stickerPath = path.join(STICKER_DIR, stickerFileName);

          if (fs.existsSync(stickerPath)) {
            msg.url = `/stickers/${stickerFileName}`;
            modified = true;
            fixed++;
            console.log(`✅ Corrigido: ${msg.messageId}`);
          } else {
            notFound++;
            console.log(`⚠️  Arquivo não encontrado: ${stickerFileName}`);
          }
        }
      }

      if (modified) {
        await conv.save();
      }
    }

    console.log("\n📊 Resumo:");
    console.log(`✅ Stickers corrigidos: ${fixed}`);
    console.log(`✅ Já estavam corretos: ${alreadyFixed}`);
    console.log(`⚠️  Arquivos não encontrados: ${notFound}`);

    await mongoose.connection.close();
    console.log("\n✅ Correção concluída!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

fixStickerUrls();
