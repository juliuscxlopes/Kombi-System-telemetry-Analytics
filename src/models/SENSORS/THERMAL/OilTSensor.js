// src/models/SENSORS/THERMAL/OilTSensor.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const historyCollector = require('../../HISTORY/HistoryCollector.js');
const thermalEngineMath = require('../../MATH/THERMAL/ThermalEngineMath.js');
const TicketManager = require('../../TICKET/TicketManager.js');
const wsEmitter = require('../../../Infra/websocket/WsEmitter.js');
const logger = require('../../../log/logger.js');

class OILTSensor {
  constructor() {
    this.sensorName = 'OIL_TEMP';
    this.ticketManager = new TicketManager(this.sensorName);
    this.ticketAtivo = null;
    this.ultimoDiagnostico = null;
  }

  async processar(value, origem) {
    try {

      // Se não veio valor — busca o atual no engine state
      if (value === null || value === undefined) {
        const raw = await redisConfig.client.hget(redisConfig.HASHES.ENGINE_STATE, this.sensorName);
        if (!raw) {
          logger.warn(`⚠️  [OILT_SENSOR] Sem valor no engine state — abortando pipeline.`);
          return;
        }
        const estado = JSON.parse(raw);
        value = estado.value;
        //logger.debug(`🔄 [OILT_SENSOR] Valor buscado do engine state: ${value}`);
      }

      //logger.info(`🔵 [OILT_SENSOR] Iniciando pipeline | value: ${value} | origem: ${origem ?? 'WS'}`);

      // 1. HISTÓRICOS
      const historicos = await historyCollector.coletar(this.sensorName);
      //logger.debug(`📚 [OILT_SENSOR] Históricos coletados | 30s: ${historicos['30s']?.length ?? 0} | 1m: ${historicos['1m']?.length ?? 0} | 3m: ${historicos['3m']?.length ?? 0} | 5m: ${historicos['5m']?.length ?? 0}`);

      // 2. MATH
      const resultado = thermalEngineMath.processar(this.sensorName, historicos);
      const diagnostico = resultado.diagnostico;
      //logger.debug(`🧮 [OILT_SENSOR] Math concluído | Severidade: ${diagnostico?.severidade} | Predictive: ${diagnostico?.predictive?.tipo ?? 'null'} | Janelas disponíveis: ${Object.keys(resultado.janelas).filter(j => resultado.janelas[j].disponivel !== false).join(', ')}`);

      // 3. TICKET MANAGER
      const ticketPayload = await this.ticketManager.processar(diagnostico.severidade, diagnostico);
      //logger.debug(`🎫 [OILT_SENSOR] Ticket | Lifecycle: ${ticketPayload.lifecycle} | Ticket: ${ticketPayload.ticket ?? 'null'}`);

      // Atualiza estado interno
      this.ultimoDiagnostico = resultado;
      if (ticketPayload.lifecycle === 'FECHADO') this.ticketAtivo = null;
      else if (ticketPayload.lifecycle !== 'DEBOUNCED' && ticketPayload.lifecycle !== 'NOOP') {
        this.ticketAtivo = ticketPayload;
      }

      // 4. ATUALIZA METRICS — sempre, independente do lifecycle
      await redisConfig.client.hset(
        redisConfig.HASHES.METRICS,
        this.sensorName,
        JSON.stringify({
          sensor: this.sensorName,
          origem: origem ?? 'WS',
          timestamp: Date.now(),
          diagnostico
        })
      );

      // DEBOUNCED ou NOOP — encerra após atualizar metrics
      if (ticketPayload.lifecycle === 'DEBOUNCED' || ticketPayload.lifecycle === 'NOOP') {
        //logger.debug(`⏭️  [OILT_SENSOR] ${ticketPayload.lifecycle} — pipeline encerrado.`);
        return;
      }

      // 5. ATUADOR PREDITIVO
      if (diagnostico.predictive) {
        const { actuator, intensity, tipo } = diagnostico.predictive;
        wsEmitter.broadcast(actuator, { intensity, tipo, timestamp: Date.now() });
        //logger.info(`⚡ [OILT_SENSOR] Preditivo disparado | ${actuator} → ${intensity}`);
      }

      // 6. BROADCAST FRONTEND
      const payloadHealth = {
        ticket: ticketPayload.ticket,
        sensor: this.sensorName,
        origem: origem ?? 'WS',
        lifecycle: ticketPayload.lifecycle,
        timestamp: Date.now(),
        janelas: resultado.janelas,
        diagnostico
      };

      wsEmitter.broadcast('health', payloadHealth);

      logger.info(`📡 [OILT_SENSOR] Pipeline concluído | Ticket: ${ticketPayload.ticket} | Severidade: ${diagnostico.severidade} | Lifecycle: ${ticketPayload.lifecycle} | Origem: ${origem ?? 'WS'}`);

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