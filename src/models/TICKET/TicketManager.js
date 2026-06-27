// src/models/TICKET/TicketManager.js
const redisConfig = require('../../Infra/Redis/config/redisConfig');
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
        logger.debug(`[TICKET_MANAGER] Entry: ${JSON.stringify(fields)}`);
        if (data.sensor === this.sensorName && data.lifecycle === 'ABERTO') {
          logger.debug(`🔍 [TICKET_MANAGER:${this.sensorName}] Ticket ativo encontrado: ${data.ticket}`);
          return data;
        }
      }

      logger.debug(`🔍 [TICKET_MANAGER:${this.sensorName}] Nenhum ticket ativo encontrado.`);
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
      logger.debug(`🎫 [TICKET_MANAGER:${this.sensorName}] Processando | Status: ${statusAtual}`);

      const ticketAtivo = await this.buscarTicketAtivo();

      // ── NORMALIZOU ─────────────────────────────────────────
      if (statusAtual === 'OPERACIONAL' || statusAtual === 'TOLERAVEL') {
        if (ticketAtivo) {
          const agora = Date.now();
          const duracaoMs = agora - ticketAtivo.aberturaTs;
          logger.info(`✅ [TICKET_MANAGER:${this.sensorName}] Fechando ticket ${ticketAtivo.ticket} | Duração: ${Math.round(duracaoMs / 1000)}s`);
          return this._montarPayload(ticketAtivo.ticket, 'OPERACIONAL', 'FECHADO', diagnosticResult, {
            aberturaTs: ticketAtivo.aberturaTs,
            fechamentoTs: agora,
            duracaoMs,
            duracaoSeg: Math.round(duracaoMs / 1000)
          });
        }
        logger.debug(`⏭️  [TICKET_MANAGER:${this.sensorName}] NOOP — sensor operacional sem ticket ativo.`);
        return { lifecycle: 'NOOP', ticket: null };
      }

      // ── SEM TICKET: abre novo ──────────────────────────────
      if (!ticketAtivo) {
        const novoTicket = this._gerarTicket();
        logger.warn(`🆕 [TICKET_MANAGER:${this.sensorName}] Abrindo ticket ${novoTicket} | Status: ${statusAtual}`);
        return this._montarPayload(novoTicket, statusAtual, 'ABERTO', diagnosticResult, {
          aberturaTs: Date.now()
        });
      }

      // ── TICKET ATIVO: verifica transições ──────────────────
      if (ticketAtivo.status === statusAtual) {
        logger.debug(`🔁 [TICKET_MANAGER:${this.sensorName}] DEBOUNCED — ticket ${ticketAtivo.ticket} já em ${statusAtual}`);
        return { lifecycle: 'DEBOUNCED', ticket: ticketAtivo.ticket };
      }

      if (ticketAtivo.status === 'ALERTA' && statusAtual === 'CRITICO') {
        logger.warn(`📈 [TICKET_MANAGER:${this.sensorName}] ESCALONADO | ${ticketAtivo.ticket} | ALERTA → CRITICO`);
        return this._montarPayload(ticketAtivo.ticket, 'CRITICO', 'ESCALONADO', diagnosticResult, {
          aberturaTs: ticketAtivo.aberturaTs,
          escalonamentoTs: Date.now()
        });
      }

      if (ticketAtivo.status === 'CRITICO' && statusAtual === 'ALERTA') {
        logger.info(`📉 [TICKET_MANAGER:${this.sensorName}] REBAIXADO | ${ticketAtivo.ticket} | CRITICO → ALERTA`);
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
      ticket,
      sensor: this.sensorName,
      status,
      lifecycle,
      ...(diagnosticResult.severidade && { severidade: diagnosticResult.severidade }),
      ...(diagnosticResult.motivos    && { motivos: diagnosticResult.motivos }),
      ...(diagnosticResult.predictive && { predictive: diagnosticResult.predictive }),
      ...timestamps,
      timestamp: Date.now()
    };
  }
}

module.exports = TicketManager;