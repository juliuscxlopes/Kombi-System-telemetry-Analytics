// src/App.js
require('dotenv').config();
const healthWorker = require('./src/Infra/Redis/workers/WorkerHealth');
const redis = require('./src/Infra/Redis/config/redisConfig');

async function bootstrap() {
  try {
    console.log("🧠 [SYSTEM] Iniciando Cérebro Analytics - Kombi System");
  
    // Inicia o Worker (que já está com while(this.running))
    healthWorker.start();

    // Tratamento de interrupção
    process.on('SIGINT', async () => {
      console.log("\n🛑 [SYSTEM] Parando Analytics...");
      healthWorker.stop(); // Muda o running para false
      await redis.client.quit();
      process.exit(0);
    });

  } catch (err) {
    console.error("❌ [FATAL] Erro:", err);
    process.exit(1);
  }
}

bootstrap();