// src/models/SENSORS/THERMAL/OilTSensor.js
const redisConfig       = require('../../../Infra/Redis/config/redisConfig');
const historyCollector  = require('../../HISTORY/HistoryCollector.js');
const thermalEngineMath = require('../../MATH/THERMAL/ThermalEngineMath.js');
const TicketManager     = require('../../TICKET/TicketManager.js');
const wsEmitter         = require('../../../Infra/websocket/WsEmitter.js');
const logger            = require('../../../log/logger.js');

class OILTSensor {
  constructor() {
    this.sensorName        = 'OIL_TEMP';
    this.ticketManager     = new TicketManager(this.sensorName);
    this.ticketAtivo       = null;  // referência leve — só id e lifecycle
    this.ultimoDiagnostico = null;
  }

  async processar(value, origem) {
    try {

      // Se não veio valor — busca o atual no ENGINE_STATE
      if (value === null || value === undefined) {
        const raw = await redisConfig.client.hget(redisConfig.HASHES.ENGINE_STATE, this.sensorName);
        if (!raw) {
          logger.warn(`⚠️  [OILT_SENSOR] Sem valor no engine state — abortando pipeline.`);
          return;
        }
        value = JSON.parse(raw).value;
      }

      // 1. HISTÓRICOS
      const historicos = await historyCollector.coletar(this.sensorName);

      // 2. MATH
      // ticketContext vem do Redis via ThermalEngineMath — sensor não monta mais isso
      const resultado   = await thermalEngineMath.processar(this.sensorName, historicos);
      const diagnostico = resultado.diagnostico;

      logger.info(`🔵 [OILT_SENSOR] Math | Nível: ${diagnostico.nivel} | Votos: taxa=${diagnostico.votos?.taxa} proj=${diagnostico.votos?.projecao} ticket=${diagnostico.deltaTicket?.estado ?? 'SEM_TICKET'} | Predictive: ${diagnostico.predictive?.tipo ?? 'null'} | Origem: ${origem ?? 'WS'}`);

      // 3. TICKET MANAGER
      const ticketPayload = await this.ticketManager.processar(diagnostico.nivel, diagnostico);

      // Atualiza referência local leve
      this.ultimoDiagnostico = resultado;
      if (ticketPayload.lifecycle === 'FECHADO') {
        this.ticketAtivo = null;
      } else if (ticketPayload.lifecycle === 'ABERTO') {
        this.ticketAtivo = { ticket: ticketPayload.ticket, lifecycle: 'ABERTO' };
      } else if (ticketPayload.lifecycle !== 'DEBOUNCED' && ticketPayload.lifecycle !== 'NOOP') {
        this.ticketAtivo = { ...this.ticketAtivo, lifecycle: ticketPayload.lifecycle };
      }

      // 4. ATUALIZA METRICS — sempre
      await redisConfig.client.hset(
        redisConfig.HASHES.METRICS,
        this.sensorName,
        JSON.stringify({
          sensor:    this.sensorName,
          origem:    origem ?? 'WS',
          timestamp: Date.now(),
          diagnostico
        })
      );

      // DEBOUNCED ou NOOP — encerra após atualizar metrics
      if (ticketPayload.lifecycle === 'DEBOUNCED' || ticketPayload.lifecycle === 'NOOP') return;

      // 5. ATUADOR PREDITIVO
      if (diagnostico.predictive) {
        const { actuator, intensity, tipo } = diagnostico.predictive;
        wsEmitter.broadcast(actuator, intensity);
        logger.info(`⚡ [OILT_SENSOR] Preditivo disparado | ${actuator} → ${intensity} (${tipo})`);
      }

      // 6. BROADCAST FRONTEND
      const payloadHealth = {
        ticket:    ticketPayload.ticket,
        sensor:    this.sensorName,
        origem:    origem ?? 'WS',
        lifecycle: ticketPayload.lifecycle,
        timestamp: Date.now(),
        janelas:   resultado.janelas,
        diagnostico
      };

      wsEmitter.broadcast('health', payloadHealth);
      logger.info(`📡 [OILT_SENSOR] Pipeline concluído | Ticket: ${ticketPayload.ticket} | Nível: ${diagnostico.nivel} | Lifecycle: ${ticketPayload.lifecycle}`);

    } catch (err) {
      logger.error(`❌ [OILT_SENSOR] Falha no pipeline: ${err.message}`);
    }
  }

  getEstado() {
    return {
      ticketAtivo:  this.ticketAtivo,
      diagnostico:  this.ultimoDiagnostico
    };
  }
}

module.exports = new OILTSensor();