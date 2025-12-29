const { validateLocaleAndSetLanguage } = require("typescript");
const mongoose = require("../database");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  number: { type: String, unique: true, required: true},
  password: { type: String, required: true },
  role: [{ type: Number, required: true }]
}, { timestamps: true });

// Gabarito de Role
// 1 - Suporte
// 2 - Treinamento
// 3 - Vendas
// 4 - Assistência Técnica
// 5 - Admin

// Antes de salvar, criptografa a senha
UserSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Verificar senha
UserSchema.methods.comparePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", UserSchema);