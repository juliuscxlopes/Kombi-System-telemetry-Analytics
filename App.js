// App.js
require('dotenv').config();
const WsConfig = require('./src/Infra/websocket/WsConfig');
const WsListener = require('./src/Infra/websocket/WsListener');
const redis = require('./src/Infra/Redis/config/redisConfig');
const logger = require('./src/log/logger');

async function bootstrap() {
  try {
    logger.info("🧠 [SYSTEM] Iniciando Cérebro Analytics - Kombi System");

    // Servidor WS do analytics (recebe frontend e envia broadcasts)
    const wsConfig = new WsConfig(process.env.WS_PORT || 3001);
    global.wsConfig = wsConfig;
    wsConfig.start((port) => {
      logger.info(`🔌 [WS] WebSocket Server escutando na porta ${port}`);
    });
    WsListener.start();

    process.on('SIGINT', async () => {
      logger.info("🛑 [SYSTEM] Parando Analytics...");
      WsListener.stop();
      await redis.client.quit();
      process.exit(0);
    });

  } catch (err) {
    logger.error(`❌ [FATAL] Erro: ${err}`);
    process.exit(1);
  }
}

bootstrap();