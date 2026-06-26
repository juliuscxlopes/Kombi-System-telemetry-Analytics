// App.js
require('dotenv').config();
const WsConfig = require('./src/Infra/websocket/WsConfig');
const WsListener = require('./src/Infra/websocket/WsListener');
const redis = require('./src/Infra/Redis/config/redisConfig');
const logger = require('./src/log/logger');

async function bootstrap() {
  try {
    logger.info("🧠 [SYSTEM] Iniciando Cérebro Analytics - Kombi System");

    const wsConfig = new WsConfig(process.env.WS_PORT || 3001);
    wsConfig.start((port) => {
      logger.info(`🔌 [WS] WebSocket Server escutando na porta ${port}`);
    });

    const wsListener = new WsListener(wsConfig.wss);  // <-- não existe ainda, mas deixa pronto
    // wsListener.start(); // descomenta quando tiver o WsListener do analytics

    process.on('SIGINT', async () => {
      logger.info("🛑 [SYSTEM] Parando Analytics...");
      await redis.client.quit();
      process.exit(0);
    });

  } catch (err) {
    logger.error(`❌ [FATAL] Erro: ${err}`);
    process.exit(1);
  }
}

bootstrap();