//BACKEND
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Conversation = require("./models/Conversation");
const Contact = require("./models/Contact");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const sharp = require("sharp");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);
const {
  makeWASocket,
  Browsers,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  downloadContentFromMessage,
} = require("baileys");
const { v4: uuidv4 } = require("uuid");
const http = require("http");
const { Server } = require("socket.io");

const PROFILE_CACHE_DIR = path.join(__dirname, "public", "profile-pics");
const STICKER_DIR = path.join(__dirname, "public", "stickers");
const AUDIO_DIR = path.join(__dirname, "public", "audios");
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

// ===== CONFIGURAÇÃO DO MULTER PARA UPLOAD DE STICKERS =====
const upload = multer({
  storage: multer.memoryStorage(), // Armazena na memória
  fileFilter: (req, file, cb) => {
    // Aceita .webp, .png, .jpg, .jpeg
    const allowedMimes = ["image/webp", "image/png", "image/jpeg"];
    const allowedExts = [".webp", ".png", ".jpg", ".jpeg"];

    const isValidMime = allowedMimes.includes(file.mimetype);
    const isValidExt = allowedExts.some((ext) =>
      file.originalname.toLowerCase().endsWith(ext)
    );

    if (isValidMime || isValidExt) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Apenas arquivos .webp, .png ou .jpeg são aceitos para stickers"
        )
      );
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limite
  },
});

// ===== CONFIGURAÇÃO DO MULTER PARA UPLOAD DE ÁUDIO =====
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de áudio não suportado"));
    }
  },
  limits: {
    fileSize: 16 * 1024 * 1024, // 16MB para áudio
  },
});

// Função para formatar número de telefone:
// 558893469953 (13 dígitos com 55) → (88) 9 8834-6995
// 247558223974625 (15 dígitos - JID BR) → (75) 5822-3974 ou similar
function formatPhoneNumber(phoneNumber) {
  let cleanNumber = phoneNumber.replace(/\D/g, "");

  // Para números muito longos (>=13), procura por padrão brasileiro com 55
  if (cleanNumber.length >= 13) {
    // Procura por 55 seguido de 2 dígitos de DDD (códigos válidos: 11-99)
    const match = cleanNumber.match(/55([1-9][0-9])(9?\d{8})/);
    if (match) {
      // Encontrou padrão brasileiro: 55 + DDD + número
      const areaCode = match[1]; // DDD (2 dígitos)
      const phoneDigits = match[2]; // 8 ou 9 dígitos
      cleanNumber = areaCode + phoneDigits;
    } else {
      // Não encontrou padrão brasileiro, tenta extrair últimos 10-11 dígitos
      // Verifica se os últimos dígitos parecem brasileiros (DDD 11-99)
      const last11 = cleanNumber.slice(-11);
      const last10 = cleanNumber.slice(-10);

      if (last11.match(/^[1-9][0-9]9\d{8}$/)) {
        // Últimos 11 dígitos: DDD + 9 + 8 dígitos
        cleanNumber = last11;
      } else if (last10.match(/^[1-9][0-9]\d{8}$/)) {
        // Últimos 10 dígitos: DDD + 8 dígitos
        cleanNumber = last10;
      } else {
        // Não parece brasileiro, retorna como internacional
        return `+${cleanNumber}`;
      }
    }
  }

  // Remove o código de país (55) se ainda estiver no início
  if (
    cleanNumber.startsWith("55") &&
    cleanNumber.length >= 12 &&
    cleanNumber.length <= 13
  ) {
    cleanNumber = cleanNumber.substring(2);
  }

  // Formata de acordo com a quantidade de dígitos
  if (cleanNumber.length === 11) {
    // COM o 9: (XX) 9 XXXX-XXXX
    const areaCode = cleanNumber.substring(0, 2);
    const firstDigit = cleanNumber.substring(2, 3);
    const middlePart = cleanNumber.substring(3, 7);
    const lastPart = cleanNumber.substring(7, 11);
    return `(${areaCode}) ${firstDigit} ${middlePart}-${lastPart}`;
  } else if (cleanNumber.length === 10) {
    // SEM o 9: (XX) XXXX-XXXX
    const areaCode = cleanNumber.substring(0, 2);
    const firstPart = cleanNumber.substring(2, 6);
    const lastPart = cleanNumber.substring(6, 10);
    return `(${areaCode}) ${firstPart}-${lastPart}`;
  } else {
    // Não conseguiu formatar, retorna como está ou com +
    if (cleanNumber.length > 11) {
      return `+${cleanNumber}`;
    }
    return cleanNumber;
  }
}

require("./database.js");

const app = express();

// ===== SEGURANÇA MÁXIMA =====

// 1. Helmet - Headers de segurança
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
        scriptSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "https://cdn.socket.io"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    xssFilter: true,
  })
);

// 2. Ocultar informações do servidor
app.disable("x-powered-by");

// 3. Rate Limiting - Proteção contra brute force e DDoS
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 300, // 300 requisições por minuto (5 req/seg)
  message: "Muitas requisições deste IP, tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 tentativas de login
  message: "Muitas tentativas de login, tente novamente em 15 minutos.",
  skipSuccessfulRequests: true,
});

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // 60 mensagens por minuto
  message: "Limite de mensagens excedido, aguarde um momento.",
});

app.use("/login", authLimiter);
app.use("/register", authLimiter);
app.use("/send-message", messageLimiter);
app.use("/send-sticker", messageLimiter);
app.use(generalLimiter);

// 4. Sanitização de dados MongoDB - Proteção contra NoSQL Injection
// Middleware manual compatível com Express 5
const sanitizeObject = (obj) => {
  if (typeof obj !== "object" || obj === null) return obj;

  Object.keys(obj).forEach((key) => {
    // Remove propriedades que começam com $ ou contêm .
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
    } else if (typeof obj[key] === "object") {
      sanitizeObject(obj[key]);
    }
  });

  return obj;
};

app.use((req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
});

// 5. Validação de tamanho de payload
app.use(bodyParser.json({ limit: "10mb" }));
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        res.status(400).json({ error: "JSON inválido" });
        throw new Error("JSON inválido");
      }
    },
  })
);

// 6. CORS configurado adequadamente
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// 6. CORS configurado adequadamente
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.static("public"));
app.use("/media", express.static(path.join(__dirname, "media")));
app.use("/profile-pics", express.static(PROFILE_CACHE_DIR));
app.use(
  "/stickers",
  express.static(path.join(__dirname, "public", "stickers"))
);
app.use("/audios", express.static(AUDIO_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e7, // 10MB max
  transports: ["websocket", "polling"],
});
let globalIO = io;

const JWT_SECRET = process.env.JWT_SECRET || "chave123";

// AVISO: Trocar JWT_SECRET em produção
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "chave123") {
  console.warn(
    "⚠️  AVISO: JWT_SECRET padrão detectado! Defina uma chave segura no arquivo .env"
  );
}

let sock;
let lastQR = null;
let lastStatus = "desconectado";

// Cria diretório de cache se não existir
if (!fs.existsSync(PROFILE_CACHE_DIR)) {
  fs.mkdirSync(PROFILE_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(STICKER_DIR)) {
  fs.mkdirSync(STICKER_DIR, { recursive: true });
}
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ===== LIMPEZA DE IMAGENS EXPIRADAS =====
async function cleanExpiredProfilePics() {
  try {
    // console.log("🧹 Limpando imagens expiradas no banco...");

    const conversations = await Conversation.find({
      img: { $regex: /^https:\/\/pps\.whatsapp\.net/ },
    });

    for (const conv of conversations) {
      const safeJid = conv.jid.replace(/[:\/\\]/g, "_");
      const fullLocalPath = path.join(PROFILE_CACHE_DIR, `${safeJid}.jpg`);

      if (fs.existsSync(fullLocalPath)) {
        conv.img = `/profile-pics/${encodeURIComponent(conv.jid)}.jpg`;
      } else {
        conv.img = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          conv.name
        )}&background=random`;
      }

      await conv.save();
    }

    // console.log(`✅ ${conversations.length} conversas atualizadas.`);
  } catch (err) {
    console.error("❌ Erro ao limpar imagens expiradas:", err);
  }
}

// ===== OBTER FOTO DE PERFIL =====
async function getProfilePicture(jid, name, isGroup = false) {
  if (isGroup) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name
    )}&background=random`;
  }

  try {
    const url = await sock.profilePictureUrl(jid, "image");
    return url;
  } catch (err) {
    // console.log(`Não conseguiu pegar foto de ${jid}: ${err.message}`);
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name
    )}&background=random`;
  }
}

// ===== INICIALIZAÇÃO DO WHATSAPP =====
const initWASocket = async (ioInstance) => {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestWaWebVersion({});
  globalIO = ioInstance;

  sock = makeWASocket({
    auth: state,
    browser: Browsers.appropriate("Desktop"),
    printQRInTerminal: false,
    version,

    getMessage: async (key) => {
      const jid = key?.remoteJid || "";
      if (
        jid.endsWith("@g.us") ||
        jid === "status@broadcast" ||
        jid.endsWith("@newsletter")
      ) {
        return { conversation: "" };
      }
      return { conversation: "" };
    },
  });

  // ===== DESABILITA EVENTOS RELACIONADOS A GRUPOS OU STATUS (FEITO 1 VEZ) =====
  // CORREÇÃO: Estes eventos devem ser registrados aqui, uma única vez,
  // e não dentro do 'messages.upsert' onde seriam registrados a cada nova mensagem.
  sock.ev.on("groups.upsert", () => {}); // ignora novos grupos
  sock.ev.on("groups.update", () => {}); // ignora atualizações
  sock.ev.on("group-participants.update", () => {}); // ignora entradas/saídas
  sock.ev.on("chats.update", () => {}); // ignora atualizações de chats de grupo
  sock.ev.on("contacts.update", () => {}); // ainda pode receber contatos diretos

  // ===== TRATAMENTO DE ERROS DE SESSÃO =====
  // Isto evita logs de erro de "No session record" que ocorrem quando o WhatsApp reenvia mensagens
  sock.ev.on("error", (err) => {
    if (err?.message?.includes("No session record")) {
      // console.log("⚠️ Ignorando erro de sessão (mensagem reenviada)");
      return; // Ignora erros de sessão faltante
    }
    console.error("❌ Erro do Socket:", err);
  });

  sock.ev.on(
    "connection.update",
    async ({ connection, qr, lastDisconnect, isNewLogin }) => {
      // console.log("📡 Connection update:", { connection, isNewLogin });

      if (qr) {
        lastQR = qr;
        // console.log("📱 QR Code gerado");
      }

      if (connection === "open") {
        lastStatus = "conectado";
        // console.log("✅ Bot conectado!");
        // console.log("📞 Número:", sock?.user?.id);
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        const reason = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message;

        // console.log("⚠️ Conexão fechada:");
        // console.log("  - Status code:", reason);
        // console.log("  - Mensagem:", errorMsg);
        // console.log("  - Deve reconectar:", shouldReconnect);

        if (reason === DisconnectReason.badSession) {
          // console.log("❌ Sessão inválida. Removendo auth...");
          fs.rmSync("./auth", { recursive: true, force: true });
          lastStatus = "desconectado";
          lastQR = null;
          // console.log("🔄 Reiniciando em 3 segundos...");
          setTimeout(() => initWASocket(globalIO), 3000);
        } else if (reason === DisconnectReason.connectionClosed) {
          // console.log("🔄 Conexão fechada. Reconectando...");
          lastStatus = "reconectando";
          setTimeout(() => initWASocket(globalIO), 3000);
        } else if (reason === DisconnectReason.connectionLost) {
          // console.log("📡 Conexão perdida. Reconectando...");
          lastStatus = "reconectando";
          setTimeout(() => initWASocket(globalIO), 5000);
        } else if (reason === DisconnectReason.connectionReplaced) {
          // console.log("🔁 Conexão substituída em outro lugar.");
          lastStatus = "desconectado";
        } else if (reason === DisconnectReason.loggedOut) {
          // console.log("👋 Deslogado. Removendo sessão...");
          fs.rmSync("./auth", { recursive: true, force: true });
          lastStatus = "desconectado";
          lastQR = null; // Limpa QR antigo
          // console.log("🔄 Iniciando nova sessão em 3 segundos...");
          setTimeout(() => initWASocket(globalIO), 3000);
        } else if (reason === DisconnectReason.restartRequired) {
          // console.log("🔄 Restart necessário. Reconectando...");
          lastStatus = "reconectando";
          setTimeout(() => initWASocket(globalIO), 2000);
        } else if (reason === DisconnectReason.timedOut) {
          // console.log("⏱️ Timeout. Reconectando...");
          lastStatus = "reconectando";
          setTimeout(() => initWASocket(globalIO), 5000);
        } else if (shouldReconnect) {
          // console.log("🔄 Tentando reconectar...");
          lastStatus = "reconectando";
          setTimeout(() => initWASocket(globalIO), 5000);
        } else {
          lastStatus = "desconectado";
        }
      }
    }
  );

  sock.ev.on("messages.upsert", async ({ messages: newMessages }) => {
    for (const msg of newMessages) {
      try {
        const jid = msg.key.remoteJid;
        if (jid?.endsWith("@g.us")) continue;
        if (jid?.endsWith("@newsletter")) continue;
        if (jid === "status@broadcast") continue;
        if (!msg.message) continue;

        const messageId = msg.key.id;
        const text =
          msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        const fromMe = msg.key.fromMe;

        if (!text) continue;

        let conv = await Conversation.findOne({ jid });
        if (!conv) {
          conv = new Conversation({
            jid,
            name: msg.pushName || "Usuário",
            status: "queue",
            messages: [],
          });
        }

        // ✅ Ignora mensagens fromMe duplicadas
        const alreadyExists = conv.messages.some(
          (m) => m.messageId === messageId
        );
        if (alreadyExists) continue;

        // timestamp
        const ts = msg.messageTimestamp?.low
          ? msg.messageTimestamp.low * 1000
          : Date.now();

        // ----- STICKER HANDLING -----
        if (msg.message.stickerMessage) {
          try {
            // baixa conteúdo da figurinha (iterable de chunks)
            const stream = await downloadContentFromMessage(
              msg.message.stickerMessage,
              "sticker"
            );
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            // Salva sticker recebido no disco
            const stickerFileName = `${messageId}.webp`;
            const stickerPath = path.join(
              __dirname,
              "public",
              "stickers",
              stickerFileName
            );

            try {
              await fs.promises.writeFile(stickerPath, buffer);
              console.log(`✅ Sticker salvo: ${stickerFileName}`);
            } catch (writeErr) {
              console.error("Erro ao salvar sticker:", writeErr);
            }

            const stickerUrl = `/stickers/${stickerFileName}`;

            conv.messages.push({
              type: "sticker",
              url: stickerUrl,
              fromMe: msg.key.fromMe || false,
              timestamp: ts,
              messageId,
            });

            await conv.save();

            // emitir via socket para front-end com type 'sticker'
            if (globalIO) {
              globalIO.emit("message:new", {
                jid,
                type: "sticker",
                url: stickerUrl,
                fromMe: msg.key.fromMe || false,
                name: msg.pushName || jid,
                messageId,
                timestamp: ts,
              });
            }

            continue; // passa pro próximo msg
          } catch (err) {
            console.error("Erro ao baixar/storer sticker:", err);
            // fallback: salvar apenas placeholder text
            conv.messages.push({
              text: "[figurinha]",
              fromMe: msg.key.fromMe || false,
              timestamp: ts,
              messageId,
            });
            await conv.save();
            if (globalIO) {
              globalIO.emit("message:new", {
                jid,
                text: "[figurinha]",
                fromMe: msg.key.fromMe || false,
                name: msg.pushName || jid,
                messageId,
                timestamp: ts,
              });
            }
            continue;
          }
        }

        // ----- AUDIO HANDLING -----
        if (msg.message.audioMessage) {
          try {
            // baixa conteúdo do áudio
            const stream = await downloadContentFromMessage(
              msg.message.audioMessage,
              "audio"
            );
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            // Salva áudio recebido no disco
            const audioFileName = `${messageId}.ogg`;
            const audioPath = path.join(AUDIO_DIR, audioFileName);

            try {
              await fs.promises.writeFile(audioPath, buffer);
              console.log(`✅ Áudio salvo: ${audioFileName}`);
            } catch (writeErr) {
              console.error("Erro ao salvar áudio:", writeErr);
            }

            const audioUrl = `/audios/${audioFileName}`;

            conv.messages.push({
              type: "audio",
              url: audioUrl,
              audioUrl: audioUrl,
              fromMe: msg.key.fromMe || false,
              timestamp: ts,
              messageId,
            });

            await conv.save();

            // emitir via socket para front-end
            if (globalIO) {
              globalIO.emit("message:new", {
                jid,
                type: "audio",
                url: audioUrl,
                audioUrl: audioUrl,
                fromMe: msg.key.fromMe || false,
                name: msg.pushName || jid,
                messageId,
                timestamp: ts,
              });
            }

            continue;
          } catch (err) {
            console.error("Erro ao baixar/salvar áudio:", err);
            // fallback: salvar apenas placeholder text
            conv.messages.push({
              text: "[áudio]",
              fromMe: msg.key.fromMe || false,
              timestamp: ts,
              messageId,
            });
            await conv.save();
            if (globalIO) {
              globalIO.emit("message:new", {
                jid,
                text: "[áudio]",
                fromMe: msg.key.fromMe || false,
                name: msg.pushName || jid,
                messageId,
                timestamp: ts,
              });
            }
            continue;
          }
        }

        conv.messages.push({
          text,
          fromMe,
          timestamp: msg.messageTimestamp?.low
            ? msg.messageTimestamp.low * 1000
            : Date.now(),
          messageId,
        });

        await conv.save();
        if (globalIO) {
          globalIO.emit("message:new", {
            jid,
            text,
            fromMe,
            name: msg.pushName || jid,
            messageId,
            timestamp: msg.messageTimestamp?.low
              ? msg.messageTimestamp.low * 1000
              : Date.now(),
          });
        }
      } catch (err) {
        console.error(
          `⚠️ Erro ao processar mensagem de ${msg.key.remoteJid}:`,
          err.message
        );
        // Continua processando outras mensagens mesmo com erro
        continue;
      }
    }
  });

  // CORREÇÃO CRÍTICA: A assinatura do evento estava errada.
  // O evento 'messages.update' retorna um ARRAY de updates.
  // Você estava desestruturando '{ messages: newMessages }' (que não existe)
  // e iterando sobre 'updates' (que estava indefinido).
  sock.ev.on("messages.update", async (updates) => {
    try {
      for (const { key, update } of updates) {
        const messageId = key.id;
        const status = update.status; // pode ser 1, 2, 3, 4 (Baileys usa números)

        if (status !== undefined) {
          // Converte para texto legível
          const statusMap = {
            1: "pending",
            2: "sent",
            3: "delivered",
            4: "read",
          };

          const readableStatus = statusMap[status] || "pending";

          await Conversation.updateOne(
            { "messages.messageId": messageId }, // encontra a conversa com a mensagem
            { $set: { "messages.$.status": readableStatus } } // atualiza apenas o campo status dessa mensagem
          );

          // console.log("📤 Atualização de status:", messageId, readableStatus);

          // Envia para todos os clientes conectados
          io.emit("message:status", { messageId, status: readableStatus });
        }
      }
    } catch (err) {
      console.error("❌ Erro em messages.update:", err);
    }
  });

  sock.ev.on("readReceipts.update", async (updates) => {
    try {
      for (const receipt of updates) {
        const messageIds = receipt.messageIds || [];
        for (const id of messageIds) {
          await Conversation.updateOne(
            { "messages.messageId": id },
            { $set: { "messages.$.status": "read" } }
          );
          if (globalIO) {
            globalIO.emit("message:status", {
              messageId: id,
              status: "read",
            });
          }
        }
      }
    } catch (err) {
      console.error("❌ Erro em readReceipts.update:", err);
    }
  });

  sock.ev.on("creds.update", saveCreds);
};

// ===== MIDDLEWARE DE AUTENTICAÇÃO =====
const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ error: "Token não fornecido" });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
};

async function getTotalUnreadCount() {
  // Busca apenas conversas de 1-para-1 (não grupos nem newsletters)
  const conversations = await Conversation.find({
    jid: {
      $not: {
        $regex: "@g.us$|@newsletter$",
      },
    },
  });

  let totalUnread = 0;
  for (const conv of conversations) {
    const unread = conv.messages.filter(
      (msg) => !msg.fromMe && msg.status !== "read"
    ).length;
    totalUnread += unread;
  }

  // console.log("📊 Total não lidas (sem grupos):", totalUnread);
  return totalUnread;
}

async function getUnreadCount(jid) {
  try {
    const conv = await Conversation.findOne({ jid });
    if (!conv) return 0;

    const unread = conv.messages.filter(
      (msg) => !msg.fromMe && msg.status !== "read"
    ).length;

    return unread;
  } catch (err) {
    console.error("❌ Erro ao contar não lidas:", err);
    return 0;
  }
}

async function markAsRead(jid) {
  try {
    // 1. Atualizar no banco de dados
    const result = await Conversation.updateOne(
      { jid },
      { $set: { "messages.$[elem].status": "read" } },
      {
        arrayFilters: [
          { "elem.fromMe": false, "elem.status": { $ne: "read" } },
        ],
      }
    );

    // 2. Enviar confirmação de leitura real para o WhatsApp
    if (sock) {
      const conv = await Conversation.findOne({ jid });
      if (conv) {
        const unreadMessages = conv.messages
          .filter((m) => !m.fromMe && m.status !== "read" && m.messageId)
          .map((m) => ({
            remoteJid: jid,
            id: m.messageId,
            fromMe: false,
          }));

        if (unreadMessages.length > 0) {
          await sock.readMessages(unreadMessages);
          // console.log(
          //   `📖 ${unreadMessages.length} mensagens marcadas como lidas no WhatsApp`
          // );
        }
      }
    }

    // 3. Notificar via socket
    if (globalIO) {
      globalIO.emit("conversation:read", { jid });

      // Atualizar contador
      const unreadCount = await getUnreadCount(jid);
      globalIO.emit("unread:update", { jid, unreadCount });
    }

    // console.log(`✅ Mensagens de ${jid} marcadas como lidas`);
    return { success: true, modified: result.modifiedCount };
  } catch (err) {
    console.error("❌ Erro ao marcar como lida:", err);
    throw err;
  }
}

// ===== ENDPOINTS =====

// Registro de usuário
app.post("/register", async (req, res) => {
  try {
    const { username, number, password, role } = req.body;

    if (
      !username ||
      !number ||
      !password ||
      !role ||
      !Array.isArray(role) ||
      role.length === 0
    ) {
      return res.json({
        success: false,
        error: "Preencha todos os campos e selecione pelo menos uma área",
      });
    }

    const existingUser = await User.findOne({ number });
    if (existingUser) {
      return res.json({ success: false, error: "Número já cadastrado" });
    }

    const user = new User({ username, number, password, role });
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { username, number, password } = req.body;
  const user = await User.findOne({ number });
  if (!user)
    return res.json({ success: false, error: "Usuário não encontrado" });

  const isMatch = await user.comparePassword(password);
  if (!isMatch) return res.json({ success: false, error: "Senha incorreta" });

  const token = jwt.sign({ id: user._id, number: user.number }, JWT_SECRET, {
    expiresIn: "365d",
  });
  res.json({ success: true, token, number: user.number });
});

// Listar usuários
app.get("/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erro ao buscar usuários", detalhes: err.message });
  }
});

// Buscar usuário específico
app.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json(user);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erro ao buscar usuário", detalhes: err.message });
  }
});

// Buscar ID do usuário por número
app.get("/user-id/:number", async (req, res) => {
  try {
    const number = req.params.number;
    const user = await User.findOne({ number }, { _id: 1 });
    if (!user)
      return res
        .status(404)
        .json({ success: false, error: "Usuário não encontrado" });
    res.json({ success: true, id: user._id });
  } catch (err) {
    res.status(500).json({ success: false, error: "Erro ao buscar usuário" });
  }
});

// Informações do usuário logado
app.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    res.json({
      username: user.username,
      number: user.number,
      role: user.role,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erro ao buscar usuário", detalhes: err.message });
  }
});

// Deletar usuário
app.delete("/users/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await User.findByIdAndDelete(id);

    if (!resultado) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    res.json({ mensagem: "Usuário deletado com sucesso" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erro ao deletar usuário", detalhes: err.message });
  }
});

// Status da conexão
app.get("/status", (req, res) => res.json({ status: lastStatus }));

// QR Code
app.get("/qr", (req, res) => {
  if (lastQR) {
    res.json({ qr: lastQR });
  } else {
    res.status(404).send("QR ainda não gerado");
  }
});

// Logout/Exit
app.get("/exit", async (req, res) => {
  try {
    fs.rmSync("./auth", { recursive: true, force: true });
    if (sock) await sock.logout().catch(() => {});
    sock = null;
    lastStatus = "desconectado";
    lastQR = null;
    res.json({ success: true, message: "Desconectado com sucesso" });
    setTimeout(() => initWASocket(globalIO), 2000);
  } catch (err) {
    res.status(500).json({ error: "Erro ao desconectar" });
  }
});

// Reset de sessão (quando há problemas de decrypt)
app.get("/reset-session", async (req, res) => {
  try {
    // console.log("🔄 Resetando sessão...");
    fs.rmSync("./auth", { recursive: true, force: true });
    if (sock) {
      await sock.logout().catch(() => {});
      await sock.end().catch(() => {});
    }
    sock = null;
    lastStatus = "desconectado";
    lastQR = null;

    // Reinicia em 2 segundos
    setTimeout(() => {
      initWASocket(globalIO);
    }, 2000);

    res.json({ success: true, message: "Sessão resetada. Reconectando..." });
  } catch (err) {
    console.error("❌ Erro ao resetar sessão:", err);
    res.status(500).json({ error: "Erro ao resetar sessão" });
  }
});

// Atualizar foto de perfil (CORRIGIDO)
app.get("/update-profile-picture/:jid", authMiddleware, async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const safeJid = jid.replace(/[:\/\\]/g, "_");
  const filePath = path.join(PROFILE_CACHE_DIR, `${safeJid}.jpg`);

  if (jid === "status@broadcast") {
    return res.json({
      img: `https://ui-avatars.com/api/?name=${encodeURIComponent(
        jid
      )}&background=random`,
    });
  }

  // console.log(`📸 Solicitando foto para ${jid}`);

  try {
    // Se já existe no cache, retorna
    if (fs.existsSync(filePath)) {
      // console.log(`✅ Usando cache local para ${jid}`);
      return res.json({ img: `/profile-pics/${safeJid}.jpg` });
    }

    // Tenta buscar no WhatsApp
    let imgUrl;
    try {
      imgUrl = await sock.profilePictureUrl(jid, "image");
      // console.log(`🟢 URL recebida do WhatsApp: ${imgUrl}`);
    } catch (err) {
      // console.log(
      //   `⚠️ Erro ao buscar URL no WhatsApp para ${jid}: ${err.message}`
      // );
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(
        jid
      )}&background=random`;
      return res.json({ img: fallback });
    }

    if (!imgUrl) {
      // console.log(`❌ Nenhuma URL retornada para ${jid}`);
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(
        jid
      )}&background=random`;
      return res.json({ img: fallback });
    }

    // Baixa e salva localmente
    const response = await axios.get(imgUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(filePath, response.data);
    // console.log(`💾 Foto salva localmente: ${filePath}`);

    return res.json({ img: `/profile-pics/${safeJid}.jpg` });
  } catch (err) {
    console.error("❌ Erro ao atualizar foto de perfil:", err);
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      jid
    )}&background=random`;
    return res.json({ img: fallback });
  }
});

// Listar conversas
app.get("/conversations", authMiddleware, async (req, res) => {
  try {
    const allConvs = await Conversation.find();
    // console.log("📋 Total de conversas:", allConvs.length);

    // Busca todos os contatos de uma vez
    const allContacts = await Contact.find();
    // console.log("📞 Total de contatos salvos:", allContacts.length);

    // Cria um mapa de JID normalizado -> Contact para busca rápida
    const contactMap = {};
    allContacts.forEach((contact) => {
      contactMap[contact.jid] = contact;
    });

    // Aplica os nomes dos contatos às conversas
    const convsWithContacts = allConvs.map((conv) => {
      const convObj = conv.toObject();

      // Ignora grupos e newsletters - não formata
      if (conv.jid.endsWith("@g.us") || conv.jid.endsWith("@newsletter")) {
        convObj.name = conv.jid; // Deixa o JID original
        return convObj;
      }

      // LIDs - mostra "Número LID"
      if (conv.jid.endsWith("@lid")) {
        convObj.name = "Número LID";
        return convObj;
      }

      // Tenta encontrar o contato usando o JID original primeiro
      if (contactMap[conv.jid]) {
        convObj.name = contactMap[conv.jid].name;
        return convObj;
      }

      // Extrai apenas a parte do número (antes do @)
      const jidParts = conv.jid.split("@");
      const phoneNumber = jidParts[0].replace(/\D/g, "");

      // Tenta normalizar o JID para buscar contato
      const normalizedJid = `${phoneNumber}@c.us`;

      if (contactMap[normalizedJid]) {
        convObj.name = contactMap[normalizedJid].name;
      } else {
        // Se não há contato salvo, formata o número do telefone
        const formattedPhone = formatPhoneNumber(phoneNumber);
        convObj.name = formattedPhone;
      }

      return convObj;
    });

    res.json(convsWithContacts);
  } catch (err) {
    console.error("Erro ao buscar conversas:", err);
    res.status(500).json({ error: "Erro ao buscar conversas" });
  }
});

// Buscar conversa específica
app.get("/conversations/:jid", authMiddleware, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ jid: req.params.jid });
    if (!conv)
      return res.status(404).json({ error: "Conversa não encontrada" });

    const convObj = conv.toObject();

    // Ignora grupos e newsletters - não formata
    if (conv.jid.endsWith("@g.us") || conv.jid.endsWith("@newsletter")) {
      convObj.name = conv.jid; // Deixa o JID original
      return res.json(convObj);
    }

    // LIDs - mostra "Número LID"
    if (conv.jid.endsWith("@lid")) {
      convObj.name = "Número LID";
      return res.json(convObj);
    }

    // Tenta encontrar contato usando o JID original primeiro
    let contact = await Contact.findOne({ jid: conv.jid });

    if (!contact) {
      // Extrai apenas a parte do número (antes do @)
      const jidParts = conv.jid.split("@");
      const phoneNumber = jidParts[0].replace(/\D/g, "");
      const normalizedJid = `${phoneNumber}@c.us`;

      // Tenta buscar com JID normalizado
      contact = await Contact.findOne({ jid: normalizedJid });
    }

    if (contact) {
      convObj.name = contact.name;
    } else {
      // Se não há contato salvo, extrai e formata o número
      const jidParts = conv.jid.split("@");
      const phoneNumber = jidParts[0].replace(/\D/g, "");
      const formattedPhone = formatPhoneNumber(phoneNumber);
      convObj.name = formattedPhone;
    }

    res.json(convObj);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar conversa" });
  }
});

// Buscar ID da conversa
app.get("/conversation-id/:jid", async (req, res) => {
  try {
    const jid = req.params.jid;
    const conversation = await Conversation.findOne({ jid }, { _id: 1 });
    if (!conversation)
      return res
        .status(404)
        .json({ success: false, error: "Conversa não encontrada" });
    res.json({ success: true, id: conversation._id });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, error: "Erro ao buscar essa conversa" });
  }
});

// Atualizar status da conversa
app.post("/conversations/:jid/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const conv = await Conversation.findOne({ jid: req.params.jid });
    if (!conv)
      return res.status(404).json({ error: "Conversa não encontrada" });

    conv.status = status;
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// Deletar conversa (CORRIGIDO)
app.delete("/conversations/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await Conversation.findByIdAndDelete(id);

    if (!resultado) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    res.json({ mensagem: "Conversa deletada com sucesso!" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erro ao deletar essa conversa", detalhes: err.message });
  }
});

// Enviar mensagem
app.post("/send", authMiddleware, async (req, res) => {
  try {
    const { jid, textFormatted } = req.body; // ⚠️ Use textFormatted do frontend

    // ✅ Validação crítica
    if (
      !textFormatted ||
      typeof textFormatted !== "string" ||
      !textFormatted.trim()
    ) {
      return res.status(400).json({ error: "Texto inválido ou vazio" });
    }

    if (!sock || lastStatus !== "conectado") {
      return res.status(400).json({ error: "Bot não está conectado." });
    }

    // ====== Adiciona imediatamente a mensagem local ======
    let conv = await Conversation.findOne({ jid });
    if (!conv) {
      conv = new Conversation({
        jid,
        name: jid,
        status: "queue",
        messages: [],
      });
    }

    const tempMessageId = `temp-${Date.now()}`;
    const newMsg = {
      text: textFormatted, // ✅ Use textFormatted
      fromMe: true,
      timestamp: Date.now(),
      messageId: tempMessageId,
      status: "pending",
    };

    conv.messages.push(newMsg);
    await conv.save();

    // ====== Envia mensagem ao WhatsApp ======
    let sendResult;
    try {
      sendResult = await sock.sendMessage(jid, { text: textFormatted }); // ✅ Use textFormatted
    } catch (err) {
      console.error("⚠️ Erro no envio via Baileys:", err);
      return res.status(500).json({
        error: "Erro ao enviar via WhatsApp",
        detalhes: err.message,
      });
    }

    // Atualiza ID e status
    if (sendResult?.key?.id) {
      const msgIndex = conv.messages.findIndex(
        (m) => m.messageId === tempMessageId
      );
      if (msgIndex >= 0) {
        conv.messages[msgIndex].messageId = sendResult.key.id;
        conv.messages[msgIndex].status = "sent";
        await conv.save();
      }
    }

    return res.json({
      success: true,
      message: {
        text: textFormatted,
        fromMe: true,
        messageId: sendResult?.key?.id || tempMessageId,
        status: "sent",
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.error("❌ Erro ao enviar mensagem:", err);
    res
      .status(500)
      .json({ error: "Erro ao enviar mensagem", detalhes: err.message });
  }
});

// ===== ENVIAR ÁUDIO =====
app.post(
  "/send-audio",
  authMiddleware,
  uploadAudio.single("audio"),
  async (req, res) => {
    try {
      const { jid } = req.body;

      // Validações
      if (!jid) {
        return res.status(400).json({ error: "JID não fornecido" });
      }

      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Arquivo de áudio não fornecido" });
      }

      if (!sock || lastStatus !== "conectado") {
        return res.status(400).json({ error: "Bot não está conectado" });
      }

      console.log("🎤 Recebendo áudio:", {
        jid,
        fileSize: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Salva temporariamente para conversão
      const tempInputPath = path.join(
        __dirname,
        `temp_input_${Date.now()}.webm`
      );
      const tempOutputPath = path.join(
        __dirname,
        `temp_output_${Date.now()}.ogg`
      );

      fs.writeFileSync(tempInputPath, req.file.buffer);

      // Converte webm para opus usando ffmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(tempInputPath)
          .audioCodec("libopus")
          .audioBitrate("64k")
          .audioChannels(1)
          .audioFrequency(16000)
          .format("ogg")
          .on("error", (err) => {
            console.error("❌ Erro na conversão:", err);
            fs.unlinkSync(tempInputPath);
            reject(err);
          })
          .on("end", () => {
            console.log("✅ Conversão concluída");
            fs.unlinkSync(tempInputPath);
            resolve();
          })
          .save(tempOutputPath);
      });

      const convertedAudio = fs.readFileSync(tempOutputPath);
      fs.unlinkSync(tempOutputPath);

      console.log("📦 Áudio convertido:", convertedAudio.length, "bytes");

      // Envia áudio convertido ao WhatsApp
      const sendResult = await sock.sendMessage(jid, {
        audio: convertedAudio,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true, // Push-to-talk (mensagem de voz)
      });

      console.log("✅ Áudio enviado com sucesso!");

      // Salva áudio no servidor
      const audioFileName = `${sendResult?.key?.id || Date.now()}.ogg`;
      const audioPath = path.join(AUDIO_DIR, audioFileName);
      fs.writeFileSync(audioPath, convertedAudio);
      const audioUrl = `/audios/${audioFileName}`;

      // Adiciona mensagem no banco
      let conv = await Conversation.findOne({ jid });
      if (!conv) {
        conv = new Conversation({
          jid,
          name: jid,
          status: "queue",
          messages: [],
        });
      }

      const newMsg = {
        type: "audio",
        fromMe: true,
        timestamp: Date.now(),
        messageId: sendResult?.key?.id || `temp-${Date.now()}`,
        status: "sent",
        url: audioUrl,
        audioUrl: audioUrl,
      };

      conv.messages.push(newMsg);
      await conv.save();

      // Emite para todos os atendentes
      globalIO.emit("message", newMsg);

      res.json({
        success: true,
        messageId: newMsg.messageId,
        timestamp: newMsg.timestamp,
        url: audioUrl,
        audioUrl: audioUrl,
      });
    } catch (err) {
      console.error("❌ Erro ao enviar áudio:", err);
      res
        .status(500)
        .json({ error: "Erro ao enviar áudio", detalhes: err.message });
    }
  }
);

// ===== ENVIAR STICKER =====
app.post(
  "/send-sticker",
  authMiddleware,
  upload.single("sticker"),
  async (req, res) => {
    try {
      const { jid } = req.body;

      // Validações
      if (!jid) {
        return res.status(400).json({ error: "JID não fornecido" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Arquivo sticker não fornecido" });
      }

      if (!sock || lastStatus !== "conectado") {
        return res.status(400).json({ error: "Bot não está conectado" });
      }

      // console.log(`📤 Enviando sticker para ${jid}`);
      // console.log(`📦 Arquivo: ${req.file.originalname}, Tamanho: ${req.file.size} bytes`);

      // ====== Converte PNG/JPEG para WebP se necessário ======
      let stickerBuffer = req.file.buffer;
      const fileExt = path.extname(req.file.originalname).toLowerCase();

      if (fileExt !== ".webp") {
        try {
          console.log(`🔄 Convertendo ${fileExt} para WebP...`);
          stickerBuffer = await sharp(req.file.buffer)
            .webp({ quality: 80 })
            .toBuffer();
          console.log("✅ Conversão concluída!");
        } catch (conversionErr) {
          console.error("❌ Erro ao converter imagem:", conversionErr);
          return res.status(400).json({
            error: "Erro ao converter imagem para WebP",
            detalhes: conversionErr.message,
          });
        }
      }

      // ====== Adiciona a mensagem de sticker ao banco de dados ======
      let conv = await Conversation.findOne({ jid });
      if (!conv) {
        conv = new Conversation({
          jid,
          name: jid,
          status: "queue",
          messages: [],
        });
      }

      const tempMessageId = `temp-${Date.now()}`;
      const newMsg = {
        type: "sticker",
        fromMe: true,
        timestamp: Date.now(),
        messageId: tempMessageId,
        status: "pending",
      };

      conv.messages.push(newMsg);
      await conv.save();

      // ====== Envia sticker ao WhatsApp ======
      let sendResult;
      try {
        sendResult = await sock.sendMessage(jid, {
          sticker: stickerBuffer, // Envia o buffer convertido
        });

        // console.log("✅ Sticker enviado com sucesso!");
      } catch (err) {
        console.error("⚠️ Erro no envio de sticker via Baileys:", err);
        return res.status(500).json({
          error: "Erro ao enviar sticker via WhatsApp",
          detalhes: err.message,
        });
      }

      // Salva sticker enviado no disco
      const realMessageId = sendResult?.key?.id || tempMessageId;
      const stickerFileName = `${realMessageId}.webp`;
      const stickerPath = path.join(
        __dirname,
        "public",
        "stickers",
        stickerFileName
      );

      try {
        await fs.promises.writeFile(stickerPath, stickerBuffer);
        console.log(`✅ Sticker enviado salvo: ${stickerFileName}`);
      } catch (writeErr) {
        console.error("Erro ao salvar sticker enviado:", writeErr);
      }

      const stickerUrl = `/stickers/${stickerFileName}`;

      // Atualiza ID, status e URL
      if (sendResult?.key?.id) {
        const msgIndex = conv.messages.findIndex(
          (m) => m.messageId === tempMessageId
        );
        if (msgIndex >= 0) {
          conv.messages[msgIndex].messageId = sendResult.key.id;
          conv.messages[msgIndex].status = "sent";
          conv.messages[msgIndex].url = stickerUrl;
          await conv.save();
        }
      }

      return res.json({
        success: true,
        message: {
          type: "sticker",
          fromMe: true,
          messageId: realMessageId,
          status: "sent",
          timestamp: Date.now(),
          url: stickerUrl,
        },
      });
    } catch (err) {
      console.error("❌ Erro ao enviar sticker:", err);
      res.status(500).json({
        error: "Erro ao enviar sticker",
        detalhes: err.message,
      });
    }
  }
);

// ===== SALVAR STICKER RECEBIDO (FAVORITAR) =====
app.post(
  "/save-sticker",
  authMiddleware,
  upload.single("sticker"),
  async (req, res) => {
    try {
      const { messageId } = req.body;

      let stickerBuffer;
      let sourceFileName = null;

      // Se veio via upload de arquivo (upload manual)
      if (req.file) {
        stickerBuffer = req.file.buffer;
        const fileExt = path.extname(req.file.originalname).toLowerCase();

        if (fileExt !== ".webp") {
          try {
            console.log(`🔄 Convertendo ${fileExt} para WebP...`);
            stickerBuffer = await sharp(req.file.buffer)
              .webp({ quality: 80 })
              .toBuffer();
          } catch (conversionErr) {
            console.error("❌ Erro ao converter imagem:", conversionErr);
            return res.status(400).json({
              error: "Erro ao converter imagem para WebP",
              detalhes: conversionErr.message,
            });
          }
        }
      }
      // Se é um sticker já existente (favoritar de mensagem)
      else if (messageId) {
        const existingPath = path.join(
          __dirname,
          "public",
          "stickers",
          `${messageId}.webp`
        );

        if (fs.existsSync(existingPath)) {
          stickerBuffer = fs.readFileSync(existingPath);
          sourceFileName = `${messageId}.webp`;
          console.log(`📋 Copiando sticker existente: ${sourceFileName}`);
        } else {
          return res.status(404).json({
            error: "Sticker não encontrado no servidor",
          });
        }
      } else {
        return res
          .status(400)
          .json({ error: "Arquivo sticker ou messageId não fornecido" });
      }

      // Salva com nome único para favoritos
      const filename = `saved-${uuidv4()}.webp`;
      const filepath = path.join(STICKER_DIR, filename);
      fs.writeFileSync(filepath, stickerBuffer);

      console.log(`💾 Sticker favoritado: ${filename}`);

      return res.json({
        success: true,
        message: "Sticker salvo com sucesso!",
        filename: filename,
        url: `/stickers/${filename}`,
      });
    } catch (err) {
      console.error("❌ Erro ao salvar sticker:", err);
      res.status(500).json({
        error: "Erro ao salvar sticker",
        detalhes: err.message,
      });
    }
  }
);

// ===== LISTAR STICKERS SALVOS =====
app.get("/stickers-list", authMiddleware, async (req, res) => {
  try {
    const stickersPath = STICKER_DIR;

    if (!fs.existsSync(stickersPath)) {
      return res.json({ success: true, stickers: [] });
    }

    const files = fs
      .readdirSync(stickersPath)
      .filter((f) => f.endsWith(".webp") && f.startsWith("saved"))
      .map((f) => ({
        name: f,
        url: `/stickers/${f}`,
        timestamp: fs.statSync(path.join(stickersPath, f)).mtimeMs,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    return res.json({ success: true, stickers: files });
  } catch (err) {
    console.error("❌ Erro ao listar stickers:", err);
    res.status(500).json({
      error: "Erro ao listar stickers",
      detalhes: err.message,
    });
  }
});

app.get("/unread-count", authMiddleware, async (req, res) => {
  try {
    const totalUnread = await getTotalUnreadCount();
    res.json({ totalUnread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/mark-as-read", authMiddleware, async (req, res) => {
  try {
    const { jid } = req.body;

    if (!jid) {
      return res.status(400).json({ error: "JID é obrigatório" });
    }

    await markAsRead(jid);

    res.json({ success: true, message: "Mensagens marcadas como lidas" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ADICIONAR CONTATO =====
app.post("/contacts", authMiddleware, async (req, res) => {
  try {
    const { name, number } = req.body;

    // Validações
    if (!name || !number) {
      return res.status(400).json({ error: "Nome e número são obrigatórios" });
    }

    // Formata o número para WhatsApp JID (remove caracteres especiais)
    const cleanNumber = number.replace(/\D/g, "");
    if (cleanNumber.length < 10) {
      return res.status(400).json({ error: "Número inválido" });
    }

    // Cria JID no formato WhatsApp
    const jid = `${cleanNumber}@c.us`;

    // Verifica se contato já existe
    const existingContact = await Contact.findOne({
      $or: [{ jid }, { number }],
    });
    if (existingContact) {
      return res.status(400).json({ error: "Este contato já existe" });
    }

    // Cria novo contato
    const newContact = new Contact({
      jid,
      name,
      number: cleanNumber,
      img: null, // Pode ser atualizada depois
    });

    await newContact.save();

    res.json({
      success: true,
      message: "Contato adicionado com sucesso",
      contact: newContact,
    });
  } catch (err) {
    console.error("Erro ao adicionar contato:", err);
    res.status(500).json({ error: "Erro ao adicionar contato" });
  }
});

// ===== VERIFICAR SE CONTATO EXISTE =====
app.get("/contact-exists/:jid", authMiddleware, async (req, res) => {
  try {
    const { jid } = req.params;
    // console.log("🔍 Verificando contato com JID recebido:", jid);

    // Normaliza o JID - extrai só o número
    const phoneNumber = jid.replace(/\D/g, "");
    const normalizedJid = `${phoneNumber}@c.us`;

    // console.log("📝 JID normalizado para busca:", normalizedJid);

    // Tenta encontrar o contato
    const contact = await Contact.findOne({ jid: normalizedJid });
    // console.log("📊 Contato encontrado?", !!contact);

    if (contact) {
      // console.log("✅ Detalhes:", { jid: contact.jid, name: contact.name });
    } else {
      // Debug: busca todos os contatos para ver o que existe
      const allContacts = await Contact.find();
      // console.log(
      //   "🔎 Todos os contatos no banco:",
      //   allContacts.map((c) => ({ jid: c.jid, name: c.name }))
      // );
    }

    res.json({
      exists: !!contact,
      contact: contact || null,
    });
  } catch (err) {
    console.error("❌ Erro ao verificar contato:", err);
    res.status(500).json({ error: "Erro ao verificar contato" });
  }
});

// ===== DELETAR CONTATO =====
app.delete("/contacts/:jid", authMiddleware, async (req, res) => {
  try {
    const { jid } = req.params;

    if (!jid) {
      return res.status(400).json({ error: "JID é obrigatório" });
    }

    // Normaliza o JID - extrai só o número
    const phoneNumber = jid.replace(/\D/g, "");
    const normalizedJid = `${phoneNumber}@c.us`;

    // console.log("🗑️ Deletando contato com JID normalizado:", normalizedJid);

    const result = await Contact.findOneAndDelete({ jid: normalizedJid });

    if (!result) {
      return res.status(404).json({ error: "Contato não encontrado" });
    }

    res.json({
      success: true,
      message: "Contato deletado com sucesso",
    });
  } catch (err) {
    console.error("Erro ao deletar contato:", err);
    res.status(500).json({ error: "Erro ao deletar contato" });
  }
});

// ===== INICIALIZAÇÃO =====
cleanExpiredProfilePics();

// ===== PROTEÇÃO CONTRA QUEDAS =====

// 1. Tratamento de erros não capturados
process.on("uncaughtException", (err) => {
  console.error("❌ ERRO NÃO CAPTURADO:", err);
  console.error("Stack:", err.stack);
  // Não encerra o processo - tenta manter o servidor rodando
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ PROMISE REJEITADA NÃO TRATADA:", reason);
  console.error("Promise:", promise);
});

// 2. Tratamento de sinais de encerramento
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function gracefulShutdown() {
  console.log("🛑 Recebido sinal de encerramento...");

  // Fecha conexões Socket.IO
  if (globalIO) {
    console.log("📡 Fechando conexões Socket.IO...");
    globalIO.close();
  }

  // Fecha servidor HTTP
  server.close(() => {
    console.log("🔌 Servidor HTTP fechado");
    process.exit(0);
  });

  // Força encerramento após 10 segundos
  setTimeout(() => {
    console.error("⏱️ Tempo esgotado, forçando encerramento...");
    process.exit(1);
  }, 10000);
}

// 3. Middleware de tratamento de erros global
app.use((err, req, res, next) => {
  console.error("❌ Erro na aplicação:", err);

  // Não expõe detalhes do erro em produção
  const errorMessage =
    process.env.NODE_ENV === "production"
      ? "Erro interno do servidor"
      : err.message;

  res.status(err.status || 500).json({
    error: errorMessage,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// 4. Reconexão automática do WhatsApp em caso de queda
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("❌ Máximo de tentativas de reconexão atingido");
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Backoff exponencial

  console.log(
    `🔄 Tentativa de reconexão ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} em ${delay}ms...`
  );

  setTimeout(() => {
    initWASocket(io);
  }, delay);
}

// Monitora status do WhatsApp
setInterval(() => {
  if (lastStatus === "desconectado" && sock) {
    console.log("⚠️ WhatsApp desconectado, tentando reconectar...");
    scheduleReconnect();
  } else if (lastStatus === "conectado") {
    reconnectAttempts = 0; // Reset contador em caso de sucesso
  }
}, 60000); // Verifica a cada 1 minuto

// ===== PROTEÇÃO CONTRA QUEDAS =====

// Tratamento de exceções não capturadas
process.on("uncaughtException", (err) => {
  console.error("❌ EXCEÇÃO NÃO CAPTURADA:", err);
  console.error("Stack:", err.stack);

  // Tenta reconectar WhatsApp se necessário
  if (lastStatus === "desconectado") {
    scheduleReconnect();
  }
});

// Tratamento de promises rejeitadas
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ PROMISE REJEITADA:", reason);
  console.error("Promise:", promise);
});

// Shutdown gracioso
const shutdown = async (signal) => {
  console.log(`\n🛑 Recebido sinal ${signal}, iniciando shutdown gracioso...`);

  try {
    // Para de aceitar novas conexões
    server.close(() => {
      console.log("✅ Servidor HTTP fechado");
    });

    // Desconecta Socket.IO
    io.close(() => {
      console.log("✅ Socket.IO fechado");
    });

    // Fecha conexão MongoDB
    await mongoose.connection.close();
    console.log("✅ MongoDB desconectado");

    console.log("✅ Shutdown completo");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro durante shutdown:", err);
    process.exit(1);
  }
};

// Captura sinais de término
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Health check endpoint
app.get("/health", (req, res) => {
  const healthStatus = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp: {
      status: lastStatus,
      reconnectAttempts: reconnectAttempts,
    },
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
    },
  };

  res.status(lastStatus === "conectado" ? 200 : 503).json(healthStatus);
});

initWASocket(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
  console.log(`🔒 Segurança máxima ativada`);
  console.log(`🛡️ Rate limiting ativo`);
  console.log(`🔐 Headers de segurança configurados`);
  console.log(`🛡️ Proteção contra quedas ativada`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
