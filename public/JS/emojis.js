// generateEmojisByCategory.js
import fs from "fs";
import https from "https";

const EMOJI_JSON_URL =
  "https://raw.githubusercontent.com/iamcal/emoji-data/master/emoji.json";

function downloadJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

function groupByCategory(emojis) {
  const categories = {};
  for (const e of emojis) {
    const cat = e.category || "Other";
    if (!categories[cat]) categories[cat] = [];
    if (e.unified) {
      try {
        const codePoints = e.unified.split("-").map(u => parseInt(u, 16));
        const emoji = String.fromCodePoint(...codePoints);
        categories[cat].push(emoji);
      } catch (err) {
        // ignora erros de conversão
      }
    }
  }
  return categories;
}

async function main() {
  console.log("📥 Baixando lista de emojis...");
  const data = await downloadJSON(EMOJI_JSON_URL);

  console.log("🗂️ Organizandos por categoria...");
  const categories = groupByCategory(data);

  const output = `// Arquivo gerado automaticamente
export const emojisByCategory = ${JSON.stringify(categories, null, 2)};`;

  fs.writeFileSync("emojisByCategory.js", output, "utf8");
  console.log("✅ emojisByCategory.js criado com sucesso!");
}

main().catch((err) => console.error("❌ Erro:", err));
