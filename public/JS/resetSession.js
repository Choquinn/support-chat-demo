// reset-session.js
// Execute este script se continuar tendo problemas: node reset-session.js

const fs = require('fs');
const path = require('path');

const authDir = path.join(__dirname, 'auth');

console.log('🔧 Resetando sessão do WhatsApp...');

if (fs.existsSync(authDir)) {
  fs.rmSync(authDir, { recursive: true, force: true });
  console.log('✅ Diretório auth removido');
} else {
  console.log('ℹ️ Diretório auth não existe');
}

console.log('✅ Reset completo! Agora execute: npm start');
console.log('📱 Você precisará escanear o QR code novamente');