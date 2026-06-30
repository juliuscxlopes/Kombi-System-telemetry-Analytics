// src/services/MetricsLooper.js
const redisConfig = require('../Infra/Redis/config/redisConfig');
const OILTSensor = require('../models/SENSORS/THERMAL/OilTSensor');
const CHTSensor = require('../models/SENSORS/THERMAL/CHTSensor');
const logger = require('../log/logger');

const ANALISE_INTERVALO_MS = 10000;
const LOOP_INTERVALO_MS = 5000;

const SENSORES = {
  OIL_TEMP: OILTSensor,
  CHT: CHTSensor
};

class MetricsLooper {
  constructor() {
    this.isRunning = false;
    this.startTs = null;
    this.warmupMs = 60000; // 1min de warmup
  }

  start() {
    this.isRunning = true;
    this.startTs = Date.now();
    //logger.info('👁️  [METRICS_LOOPER] Watchdog iniciado — aguardando 1min de warmup.');
    this._loop();
  }

  async _loop() {
    while (this.isRunning) {
      await this._verificarSensores();
      await new Promise(resolve => setTimeout(resolve, LOOP_INTERVALO_MS));
    }
  }

  async _verificarSensores() {
    // Aguarda warmup antes da primeira análise
    if (Date.now() - this.startTs < this.warmupMs) {
      //logger.debug(`👁️  [METRICS_LOOPER] Warmup em andamento — ${Math.round((Date.now() - this.startTs) / 1000)}s / 60s`);
      return;
    }
    for (const [sensorName, sensor] of Object.entries(SENSORES)) {
      try {

        // Se já tem ticket ativo — sensor já está sendo analisado continuamente
        const ticketAtivo = await redisConfig.client.hget(redisConfig.HASHES.ALERTS, sensorName);
        if (ticketAtivo) {
          logger.debug(`👁️  [METRICS_LOOPER] ${sensorName} com ticket ativo — análise contínua via WS. Looper em standby.`);
          continue;
        }

        // Sem ticket — verifica se precisa de análise preditiva
        const ultimaAnalise = await this._buscarUltimaAnalise(sensorName);
        const agora = Date.now();

        if (!ultimaAnalise) {
          logger.info(`👁️  [METRICS_LOOPER] ${sensorName} sem análise — solicitando imediatamente.`);
          await sensor.processar(null, 'PredictiveAnalyzer');
          continue;
        }

        const idadeMs = agora - ultimaAnalise.timestamp;
        if (idadeMs > ANALISE_INTERVALO_MS) {
          logger.info(`👁️  [METRICS_LOOPER] ${sensorName} análise antiga (${Math.round(idadeMs / 1000)}s) — solicitando nova.`);
          await sensor.processar(null, 'PredictiveAnalyzer');
        } else {
          logger.debug(`👁️  [METRICS_LOOPER] ${sensorName} análise recente (${Math.round(idadeMs / 1000)}s) — ok.`);
        }

      } catch (err) {
        logger.error(`❌ [METRICS_LOOPER] Erro ao verificar ${sensorName}: ${err.message}`);
      }
    }
  }

  async _buscarUltimaAnalise(sensorName) {
    try {
      const raw = await redisConfig.client.hget(redisConfig.HASHES.METRICS, sensorName);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      logger.error(`❌ [METRICS_LOOPER] Erro ao buscar análise de ${sensorName}: ${err.message}`);
      return null;
    }
  }

  stop() {
    this.isRunning = false;
    logger.info('🛑 [METRICS_LOOPER] Watchdog encerrado.');
  }
}

module.exports = new MetricsLooper();