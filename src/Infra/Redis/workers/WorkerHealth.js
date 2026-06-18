// src/Infra/Redis/workers/WorkerHealth.js
const redisConfig = require('../config/redisConfig');
const sensorRouterController = require('../../../Controllers/SensorRouterController');

class WorkerHealth {
  constructor() {
    this.isListening = false;
  }

  start() {
    console.log("📡 [WORKER] Sentinela de Infraestrutura Inicializado (Modo Reativo Irrestrito).");
    this.isListening = true;
    this.escutarAlertas();
  }

  /**
   * Ciclo de escuta bloqueante focado na Stream de Alertas.
   * Acorda com QUALQUER anomalia notificada pelo Core.
   */
  async escutarAlertas() {
    let lastId = '$';

    while (this.isListening) {
      try {
        // Escuta bloqueante na stream de alertas do Core: 'kombi:stream:alerts'
        const streamData = await redisConfig.client.xread(
          'BLOCK', 5000, 
          'STREAMS', 'kombi:stream:alerts', 
          lastId
        );

        if (!streamData) continue;

        const [key, messages] = streamData[0];
        
        for (const [messageId, fields] of messages) {
          lastId = messageId; 

          const payloadIdx = fields.indexOf('payload');
          if (payloadIdx !== -1) {
            const alerta = JSON.parse(fields[payloadIdx + 1]);
            const { sensor, status, tag, value } = alerta; 

            if (sensor && (status === 'ALERTA' || status === 'CRITICO' || status === 'ALERT' || status === 'CRITICAL')) {
              console.warn(`🚨 [WORKER_HEALTH] Alerta/Anomalia recebida [Tag: ${tag}] para ${sensor}. Status: ${status}. Valor: ${value}`);
              
              // Aciona o controlador com a anomalia informada repassando a chave inteira
              await this.processarAlerta(sensor);
            }
          }
        }
      } catch (err) {
        if (this.isListening) {
          console.error('❌ [WORKER_HEALTH] Erro na escuta da stream de alertas:', err.message);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Pega o estado atualizado do sensor na HSET para repassar ao pipeline.
   */
  async processarAlerta(sensorName) {
    try {
      const engineState = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE);
      if (!engineState || !engineState[sensorName]) return;

      const payload = JSON.parse(engineState[sensorName]);
      const valorAtual = payload.value !== undefined ? payload.value : payload.val;

      // Chama o controller para processar o estouro de barreira sem intermediários
      await sensorRouterController.rotear(sensorName, valorAtual, engineState);
    } catch (err) {
      console.error(`❌ [WORKER_HEALTH] Erro ao processar alerta do sensor ${sensorName}:`, err.message);
    }
  }

  stop() {
    this.isListening = false;
    console.log("🛑 [WORKER] Sentinela de infraestrutura pausado.");
  }
}

module.exports = new WorkerHealth();