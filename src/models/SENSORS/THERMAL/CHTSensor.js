// src/models/SENSORS/THERMAL/CHTSensor.js
const historyCollector = require('../../HISTORY/HistoryCollector.js');
const thermalEngineMath = require('../../MATH/THERMAL/ThermalEngineMath.js');
const TicketManager = require('../../TICKET/TicketManager.js');
const wsEmitter = require('../../../Infra/websocket/WsEmitter.js');
const publisherService = require('../../../Infra/Redis/Publisher/PublisherService.js');
const logger = require('../../../log/logger.js');

const STREAM_ALERTS = 'stream:alerts';
const STREAM_HEALTH = 'stream:health';

class CHTSensor {
  constructor() {
    this.sensorName = 'CHT_TEMP';
    this.ticketManager = new TicketManager(this.sensorName);
    this.ticketAtivo = null;
    this.ultimoDiagnostico = null;
  }

  async processar(value, rawGlobalState) {
    try {
      logger.info(`🔵 [CHT_SENSOR] Iniciando pipeline | value: ${value}`);

      // 1. HISTÓRICOS
      const historicos = await historyCollector.coletar(this.sensorName);
      logger.debug(`📚 [CHT_SENSOR] Históricos coletados | 30s: ${historicos['30s']?.length ?? 0} | 1m: ${historicos['1m']?.length ?? 0} | 3m: ${historicos['3m']?.length ?? 0} | 5m: ${historicos['5m']?.length ?? 0}`);

      // 2. MATH
      const resultado = thermalEngineMath.processar(this.sensorName, historicos);
      const diagnostico = resultado.diagnostico;
      logger.debug(`🧮 [CHT_SENSOR] Math concluído | Severidade: ${diagnostico?.severidade} | Predictive: ${diagnostico?.predictive?.tipo ?? 'null'} | Janelas disponíveis: ${Object.keys(resultado.janelas).filter(j => resultado.janelas[j].disponivel !== false).join(', ')}`);

      // 3. TICKET MANAGER
      const ticketPayload = await this.ticketManager.processar(diagnostico.severidade, diagnostico);
      logger.debug(`🎫 [CHT_SENSOR] Ticket | Lifecycle: ${ticketPayload.lifecycle} | Ticket: ${ticketPayload.ticket ?? 'null'}`);

      // Atualiza estado interno
      this.ultimoDiagnostico = resultado;
      if (ticketPayload.lifecycle === 'FECHADO') this.ticketAtivo = null;
      else if (ticketPayload.lifecycle !== 'DEBOUNCED' && ticketPayload.lifecycle !== 'NOOP') {
        this.ticketAtivo = ticketPayload;
      }

      if (ticketPayload.lifecycle === 'DEBOUNCED' || ticketPayload.lifecycle === 'NOOP') {
        logger.debug(`⏭️  [CHT_SENSOR] ${ticketPayload.lifecycle} — pipeline encerrado.`);
        return;
      }

      // 4. STREAM:ALERTS
      await publisherService.health(STREAM_ALERTS, ticketPayload, {});
      logger.info(`🚨 [CHT_SENSOR] Publicado em stream:alerts | Lifecycle: ${ticketPayload.lifecycle}`);

      // 5. ATUADOR PREDITIVO
      if (diagnostico.predictive) {
        const { actuator, intensity, tipo } = diagnostico.predictive;
        wsEmitter.broadcast(actuator, { intensity, tipo, timestamp: Date.now() });
        logger.info(`⚡ [CHT_SENSOR] Preditivo disparado | ${actuator} → ${intensity}`);
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

      logger.info(`📡 [CHT_SENSOR] Pipeline concluído | Ticket: ${ticketPayload.ticket} | Severidade: ${diagnostico.severidade} | Lifecycle: ${ticketPayload.lifecycle}`);

    } catch (err) {
      logger.error(`❌ [CHT_SENSOR] Falha no pipeline: ${err.message}`);
    }
  }

  getEstado() {
    return {
      ticketAtivo: this.ticketAtivo,
      diagnostico: this.ultimoDiagnostico
    };
  }
}

module.exports = new CHTSensor();