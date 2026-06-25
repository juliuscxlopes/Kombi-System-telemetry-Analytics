// src/models/SENSORS/THERMAL/OilTSensor.js
const historyCollector = require('../HISTORY/HistoryCollector');
const thermalEngineMath = require('../MATH/THERMAL/ThermalEngineMath');
const TicketManager = require('../TICKET/TicketManager');
const wsEmitter = require('../../Infra/websocket/WsEmitter');
const publisherService = require('../../Infra/Redis/Publisher/PublisherService');
const logger = require('../../log/logger');

const STREAM_ALERTS = 'stream:alerts';
const STREAM_HEALTH = 'stream:health';

class OILTSensor {
  constructor() {
    this.sensorName = 'OIL_TEMP';
    this.ticketManager = new TicketManager(this.sensorName);
    this.ticketAtivo = null;
    this.ultimoDiagnostico = null;
  }

  async processar(value, rawGlobalState) {
    try {

      // 1. HISTÓRICOS
      const historicos = await historyCollector.coletar(this.sensorName);

      // 2. MATH
      const resultado = thermalEngineMath.processar(this.sensorName, historicos);
      const diagnostico = resultado.diagnostico;

      // 3. TICKET MANAGER
      const ticketPayload = await this.ticketManager.processar(diagnostico.severidade, diagnostico);

      // Atualiza estado interno
      this.ultimoDiagnostico = resultado;
      if (ticketPayload.lifecycle === 'FECHADO')  this.ticketAtivo = null;
      else if (ticketPayload.lifecycle !== 'DEBOUNCED' && ticketPayload.lifecycle !== 'NOOP') {
        this.ticketAtivo = ticketPayload;
      }

      // DEBOUNCED ou NOOP — nada a fazer
      if (ticketPayload.lifecycle === 'DEBOUNCED' || ticketPayload.lifecycle === 'NOOP') return;

      // 4. STREAM:ALERTS — ciclo de vida do ticket
      await publisherService.health(STREAM_ALERTS, ticketPayload, {});

      // 5. ATUADOR PREDITIVO
      if (diagnostico.predictive) {
        const { actuator, intensity, tipo } = diagnostico.predictive;
        wsEmitter.broadcast(actuator, { intensity, tipo, timestamp: Date.now() });
      }

      // 6. STREAM:HEALTH + BROADCAST FRONTEND
      const payloadHealth = {
        ticket: ticketPayload.ticket,
        sensor: this.sensorName,
        lifecycle: ticketPayload.lifecycle,
        timestamp: Date.now(),
        janelas: resultado.janelas,
        diagnostico
      };

      await publisherService.health(STREAM_HEALTH, payloadHealth, {});
      wsEmitter.broadcast('health', payloadHealth);

      logger.info(`📡 [OILT_SENSOR] Pipeline concluído | Ticket: ${ticketPayload.ticket} | Severidade: ${diagnostico.severidade} | Lifecycle: ${ticketPayload.lifecycle}`);

    } catch (err) {
      logger.error(`❌ [OILT_SENSOR] Falha no pipeline: ${err.message}`);
    }
  }

  getEstado() {
    return {
      ticketAtivo: this.ticketAtivo,
      diagnostico: this.ultimoDiagnostico
    };
  }
}

module.exports = new OILTSensor();