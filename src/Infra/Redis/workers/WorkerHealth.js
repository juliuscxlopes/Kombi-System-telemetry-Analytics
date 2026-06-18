// src/Infra/Redis/workers/WorkerHealth.js
const redisConfig = require('../config/redisConfig');
const sensorRouterController = require('../../../Controllers/SensorRouterController');

class WorkerHealth {
  constructor() {
    this.intervalId = null;
  }

  start() {
    console.log("📡 [WORKER] Sentinela de Infraestrutura Inicializado (Modo Hash Polling).");

    // Loop puro de alta frequência (250ms) varrendo a Hash estática do motor
    this.intervalId = setInterval(async () => {
      await this.verificarEstadoMotor();
    }, 250);
  }

  async verificarEstadoMotor() {
    try {
      // Puxa a Hash estática com a foto atual de todos os sensores
      const engineState = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE);
      if (!engineState) return;

      // Varre cada sensor dentro da Hash (OIL_TEMP, CHT, RPM, etc.)
      for (const [sensorName, rawPayload] of Object.entries(engineState)) {
        try {
          const payload = JSON.parse(rawPayload);
          const valorAtual = payload.value !== undefined ? payload.value : payload.val;

          if (sensorName) {
            // Envia direto e reto para o seu roteador processar sem intermediários
            await sensorRouterController.rotear(sensorName, valorAtual, engineState);
          }
        } catch (parseErr) {
          // Ignora payloads corrompidos ou chaves inválidas na Hash
          continue;
        }
      }
    } catch (err) {
      console.error('❌ [WORKER_HEALTH] Erro ao ler Hash kombi:engine:state:', err.message);
    }
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    console.log("🛑 [WORKER] Loops de infraestrutura parados.");
  }
}

module.exports = new WorkerHealth();