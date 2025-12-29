const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema({
  jid: { type: String, unique: true },
  name: String,
  number: { type: String, unique: true, required: true },
  img: String
});

module.exports = mongoose.model("Contact", contactSchema);