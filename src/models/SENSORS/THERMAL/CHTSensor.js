// src/models/THERMAL/OilTSensor.js
const historyCollector = require('../../models/HISTORY/HistoryCollector.JS');
const thermalEngineMath = require('../../models/MATH/THERMAL/ThermalEngineMath');
const oilTemperatureModel = require('../../models/SENSORS/ENGINE/OIL/OilTemperatureSensorModel');
const wsEmitter = require('../../Infra/websocket/WsEmitter');
const publisherService = require('../../Infra/Redis/Publisher/PublisherService');
const logger = require('../../log/logger');

class CHTSensor {
  constructor() {
    this.sensorName = 'CHT_TEMP';
  }

  async processar(ticket, value, rawGlobalState) {
    try {

      // 1. HISTÓRICOS
      const historicos = await historyCollector.coletar(this.sensorName);

      // 2. MATH — calcula métricas de todas as janelas + diagnóstico da 1m
      const resultado = thermalEngineMath.processar(ticket, this.sensorName, historicos);

      // 3. MODELO — gerencia ciclo de vida do ticket na stream:alerts
      const lifecycleResult = await oilTemperatureModel.processarMonitoramento(
        ticket,
        resultado.diagnostico.severidade,
        resultado.diagnostico
      );

      // 4. ATUADOR — dispara comando preditivo direto via WS
      if (resultado.diagnostico?.predictive) {
        const { actuator, intensity, tipo } = resultado.diagnostico.predictive;
        wsEmitter.broadcast(actuator, { intensity, tipo, timestamp: Date.now() });
      }

      // 5. PUBLICA NA STREAM HEALTH
      await publisherService.health('stream:health', {
        ticket,
        sensor: this.sensorName,
        lifecycle: lifecycleResult.lifecycle,
        timestamp: Date.now(),
        janelas: resultado.janelas,
        diagnostico: resultado.diagnostico
      }, {});
      
      // 6. BROADCAST PARA O FRONTEND
      wsEmitter.broadcast('health', payloadHealth);

      return {
        ticketAtivo: this.ticketAtivo,
        diagnostico: resultado  // retorno do thermalEngineMath
      };

      logger.info(`📡 [CONTROLLER_OILT] Pipeline concluído | Ticket: ${ticket} | Severidade: ${resultado.diagnostico.severidade} | Lifecycle: ${lifecycleResult.lifecycle}`);

    } catch (err) {
      logger.error(`❌ [CONTROLLER_OILT] Falha no pipeline: ${err.message}`);
    }
  }
}

module.exports = new CHTSensor();