// src/Infra/Redis/workers/WorkerHealth.js
const redisConfig = require('../config/redisConfig');
const sensorRouterController = require('../../../Controllers/SensorRouterController');

class WorkerHealth {
  constructor() {
    this.isListening = false;
    this.pollIntervalMs = 1000; // Roda a verificação a cada 1 segundo (ajustável)
    this.ultimosAlertasNotificados = new Map(); // 🛑 Cache de supressão (Debounce de notificação)
  }

  start() {
    console.log("📡 [WORKER] Sentinela de Infraestrutura Inicializado (Modo Sentinela de Contenção via HSET).");
    this.isListening = true;
    this.monitorarAlertas();
  }

  /**
   * Ciclo de monitoramento (polling) na HSET de Alertas Ativos.
   * Lê o painel de anomalias, processa as providências e monitora até normalizar.
   */
  async monitorarAlertas() {
    while (this.isListening) {
      try {
        // Pega todos os alertas ativos no quadro unificado (HSET motor:alerts:state)
        const alertasAtivos = await redisConfig.client.hgetall(redisConfig.HASHES.ALERTS);

        // Se o quadro estiver vazio, limpa o cache de supressão e aguarda
        if (!alertasAtivos || Object.keys(alertasAtivos).length === 0) {
          this.ultimosAlertasNotificados.clear();
          await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
          continue;
        }

        // Itera sobre cada sensor que está registrado como alerta/crítico no quadro
        for (const [sensorName, alertaString] of Object.entries(alertasAtivos)) {
          const alerta = JSON.parse(alertaString);
          
          // 🧠 Chave de identificação única do estado da anomalia no painel
          const chaveEspectro = `${alerta.sensor}:${alerta.status}`;

          // 🛑 DEBOUNCE DE EXIBIÇÃO/LOG: Se o ticket do alerta for idêntico ao já notificado, suprime a repetição visual
          if (this.ultimosAlertasNotificados.get(chaveEspectro) !== alerta.ticket) {
            console.warn(`🚨 [WORKER_HEALTH] Combatendo anomalia | Sensor: ${alerta.sensor} | Status: ${alerta.status} | Ticket: ${alerta.ticket}`);
            // Atualiza a memória com o ticket ativo para silenciar os próximos pulsos
            this.ultimosAlertasNotificados.set(chaveEspectro, alerta.ticket);
          }

          // Aciona o controlador com a anomalia para garantir a atuação contínua e processamento
          await this.processarAlerta(sensorName);
        }

        // Aguarda o intervalo do próximo ciclo de contenção
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));

      } catch (err) {
        if (this.isListening) {
          console.error('❌ [WORKER_HEALTH] Erro no ciclo de contenção do quadro de alertas:', err.message);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  /**
   * Pega o estado atualizado do sensor na HSET principal para repassar ao pipeline.
   */
  async processarAlerta(sensorName) {
    try {
      // Busca a foto instantânea do motor
      const engineState = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE);
      if (!engineState || !engineState[sensorName]) return;

      const payload = JSON.parse(engineState[sensorName]);
      const valorAtual = payload.value !== undefined ? payload.value : payload.val;

      // Chama o controller para processar a análise e tomar providências
      await sensorRouterController.rotear(sensorName, valorAtual, engineState);
    } catch (err) {
      console.error(`❌ [WORKER_HEALTH] Erro ao processar contenção do sensor ${sensorName}:`, err.message);
    }
  }

  stop() {
    this.isListening = false;
    this.ultimosAlertasNotificados.clear();
    console.log("🛑 [WORKER] Sentinela de infraestrutura pausado.");
  }
}

module.exports = new WorkerHealth();