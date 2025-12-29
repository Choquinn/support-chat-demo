require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/secure-login";

async function seedDatabase() {
  try {
    // Conecta ao MongoDB
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB conectado");

    // Verifica se o usuário já existe
    const existingUser = await User.findOne({ number: "88993469953" });

    if (existingUser) {
      console.log("⚠️  Usuário já existe no banco de dados");
      console.log("Dados existentes:", {
        username: existingUser.username,
        number: existingUser.number,
        roles: existingUser.role,
      });

      // Pergunta se deseja atualizar
      console.log("\n🔄 Atualizando senha e roles...");
      existingUser.password = "350sahara";
      existingUser.role = [1, 2, 3, 4, 5];
      await existingUser.save();
      console.log("✅ Usuário atualizado com sucesso!");
    } else {
      // Cria novo usuário
      const newUser = new User({
        username: "Paulinn",
        number: "88993469953",
        password: "350sahara",
        role: [1, 2, 3, 4, 5],
      });

      await newUser.save();
      console.log("✅ Usuário criado com sucesso!");
    }

    console.log("\n📋 Detalhes do usuário:");
    console.log("Nome: Paulinn");
    console.log("Número: 88993469953");
    console.log("Senha: 350sahara");
    console.log("Roles: [1, 2, 3, 4, 5]");
    console.log("  1 - Suporte");
    console.log("  2 - Treinamento");
    console.log("  3 - Vendas");
    console.log("  4 - Assistência Técnica");
    console.log("  5 - Admin");

    // Desconecta
    await mongoose.connection.close();
    console.log("\n✅ Seed concluído com sucesso!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao fazer seed:", error);
    process.exit(1);
  }
}

seedDatabase();
