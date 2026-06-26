// src/models/TICKET/TicketManager.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const logger = require('../../log/logger');

const STREAM_ALERTS = 'stream:alerts';

class TicketManager {
  constructor(sensorName) {
    this.sensorName = sensorName;
  }

  async buscarTicketAtivo() {
    try {
      const entries = await redisConfig.client.xrevrange(STREAM_ALERTS, '+', '-', 'COUNT', 50);

      for (const [id, fields] of entries) {
        const data = JSON.parse(fields[1]);
        if (data.sensor === this.sensorName && data.lifecycle === 'ABERTO') {
          return data;
        }
      }
      return null;

    } catch (err) {
      logger.error(`❌ [TICKET_MANAGER:${this.sensorName}] Falha ao buscar ticket ativo: ${err.message}`);
      return null;
    }
  }

  _gerarTicket() {
    return `TICKET_${this.sensorName}_${Date.now()}`;
  }

  async processar(statusAtual, diagnosticResult) {
    try {
      const ticketAtivo = await this.buscarTicketAtivo();

      // ── NORMALIZOU ─────────────────────────────────────────
      if (statusAtual === 'OPERACIONAL' || statusAtual === 'TOLERAVEL') {
        if (ticketAtivo) {
          return this._montarPayload(ticketAtivo.ticket, 'OPERACIONAL', 'FECHADO', diagnosticResult, {
            aberturaTs: ticketAtivo.aberturaTs,
            fechamentoTs: Date.now(),
            duracaoMs: Date.now() - ticketAtivo.aberturaTs,
            duracaoSeg: Math.round((Date.now() - ticketAtivo.aberturaTs) / 1000)
          });
        }
        return { lifecycle: 'NOOP', ticket: null };
      }

      // ── SEM TICKET: abre novo ──────────────────────────────
      if (!ticketAtivo) {
        const novoTicket = this._gerarTicket();
        return this._montarPayload(novoTicket, statusAtual, 'ABERTO', diagnosticResult, {
          aberturaTs: Date.now()
        });
      }

      // ── TICKET ATIVO: verifica transições ──────────────────
      if (ticketAtivo.status === statusAtual) {
        return { lifecycle: 'DEBOUNCED', ticket: ticketAtivo.ticket };
      }

      if (ticketAtivo.status === 'ALERTA' && statusAtual === 'CRITICO') {
        return this._montarPayload(ticketAtivo.ticket, 'CRITICO', 'ESCALONADO', diagnosticResult, {
          aberturaTs: ticketAtivo.aberturaTs,
          escalonamentoTs: Date.now()
        });
      }

      if (ticketAtivo.status === 'CRITICO' && statusAtual === 'ALERTA') {
        return this._montarPayload(ticketAtivo.ticket, 'ALERTA', 'REBAIXADO', diagnosticResult, {
          aberturaTs: ticketAtivo.aberturaTs,
          rebaixamentoTs: Date.now()
        });
      }

    } catch (err) {
      logger.error(`❌ [TICKET_MANAGER:${this.sensorName}] Falha ao processar: ${err.message}`);
      throw err;
    }
  }

  _montarPayload(ticket, status, lifecycle, diagnosticResult = {}, timestamps = {}) {
    return {
      // BASE DO TICKET
      ticket,
      sensor: this.sensorName,
      status,
      lifecycle,
      // AGREGADO DO DIAGNOSTIC (complementa, não substitui)
      ...(diagnosticResult.severidade  && { severidade: diagnosticResult.severidade }),
      ...(diagnosticResult.motivos     && { motivos: diagnosticResult.motivos }),
      ...(diagnosticResult.predictive  && { predictive: diagnosticResult.predictive }),
      // TIMESTAMPS
      ...timestamps,
      timestamp: Date.now()
    };
  }
}

module.exports = TicketManager;