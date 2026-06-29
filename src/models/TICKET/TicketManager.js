const redisConfig = require('../../Infra/Redis/config/redisConfig');
const logger = require('../../log/logger');

class TicketManager {
  constructor(sensorName) {
    this.sensorName = sensorName;
    // Hierarquia de severidade para identificar subidas e descidas de status
    this.hierarquia = {
      'OPERACIONAL': 0,
      'TOLERAVEL': 0,
      'PREDICTIVE_1': 1,
      'PREDICTIVE_2': 2,
      'PREDICTIVE_3': 3,
      'PREDICTIVE_4': 4
    };
  }

  async buscarTicketAtivo() {
    try {
      const raw = await redisConfig.client.hget(redisConfig.HASHES.ALERTS, this.sensorName);
      if (!raw) {
        logger.debug(`🔍 [TICKET_MANAGER:${this.sensorName}] Nenhum ticket ativo encontrado.`);
        return null;
      }

      const data = JSON.parse(raw);

      if (data.lifecycle === 'ABERTO' || data.lifecycle === 'ESCALONADO' || data.lifecycle === 'REBAIXADO') {
        logger.debug(`🔍 [TICKET_MANAGER:${this.sensorName}] Ticket ativo encontrado: ${data.ticket}`);
        return data;
      }

      logger.debug(`🔍 [TICKET_MANAGER:${this.sensorName}] Ticket existe mas lifecycle: ${data.lifecycle}`);
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
      logger.debug(`🎫 [TICKET_MANAGER:${this.sensorName}] Processando | Status (Nível): ${statusAtual}`);

      const ticketAtivo = await this.buscarTicketAtivo();

      // ── NORMALIZOU ─────────────────────────────────────────
      if (statusAtual === 'OPERACIONAL' || statusAtual === 'TOLERAVEL') {
        if (ticketAtivo) {
          const agora = Date.now();
          const duracaoMs = agora - ticketAtivo.aberturaTs;
          const payload = this._montarPayload(ticketAtivo.ticket, 'OPERACIONAL', 'FECHADO', diagnosticResult, {
            aberturaTs: ticketAtivo.aberturaTs,
            fechamentoTs: agora,
            duracaoMs,
            duracaoSeg: Math.round(duracaoMs / 1000)
          });
          await redisConfig.client.hdel(redisConfig.HASHES.ALERTS, this.sensorName);
          logger.info(`✅ [TICKET_MANAGER:${this.sensorName}] Ticket FECHADO ${ticketAtivo.ticket} | Duração: ${Math.round(duracaoMs / 1000)}s`);
          return payload;
        }
        logger.debug(`⏭️  [TICKET_MANAGER:${this.sensorName}] NOOP — sensor operacional sem ticket ativo.`);
        return { lifecycle: 'NOOP', ticket: null };
      }

      // ── SEM TICKET: abre novo ──────────────────────────────
      if (!ticketAtivo) {
        const statusFisico = await this._buscarStatusFisico();
        if (statusFisico === 'FRIO' || statusFisico === 'OFF') {
          logger.debug(`🧊 [TICKET_MANAGER:${this.sensorName}] Sensor em ${statusFisico} — ticket bloqueado.`);
          return { lifecycle: 'NOOP', ticket: null };
        }

        const novoTicket = this._gerarTicket();
        const payload = this._montarPayload(novoTicket, statusAtual, 'ABERTO', diagnosticResult, {
          aberturaTs: Date.now()
        });
        await redisConfig.client.hset(redisConfig.HASHES.ALERTS, this.sensorName, JSON.stringify(payload));
        logger.warn(`🆕 [TICKET_MANAGER:${this.sensorName}] Ticket ABERTO ${novoTicket} | Status: ${statusAtual}`);
        return payload;
      }

      // ── TICKET ATIVO: transição DEBOUNCED ──────────────────
      if (ticketAtivo.status === statusAtual) {
        logger.debug(`🔁 [TICKET_MANAGER:${this.sensorName}] DEBOUNCED — ticket ${ticketAtivo.ticket} já em ${statusAtual}`);
        return { lifecycle: 'DEBOUNCED', ticket: ticketAtivo.ticket };
      }

      // ── TICKET ATIVO: verifica ESCALONAMENTO ou REBAIXAMENTO ──
      const pesoAnterior = this.hierarquia[ticketAtivo.status] || 0;
      const pesoAtual = this.hierarquia[statusAtual] || 0;

      if (pesoAtual > pesoAnterior) {
        // Escalonamento de severidade
        const payload = this._montarPayload(ticketAtivo.ticket, statusAtual, 'ESCALONADO', diagnosticResult, {
          aberturaTs: ticketAtivo.aberturaTs,
          escalonamentoTs: Date.now()
        });
        await redisConfig.client.hset(redisConfig.HASHES.ALERTS, this.sensorName, JSON.stringify(payload));
        logger.warn(`📈 [TICKET_MANAGER:${this.sensorName}] Ticket ESCALONADO ${ticketAtivo.ticket} | ${ticketAtivo.status} → ${statusAtual}`);
        return payload;
      }

      if (pesoAtual < pesoAnterior) {
        // Rebaixamento de severidade (contenção surtindo efeito)
        const payload = this._montarPayload(ticketAtivo.ticket, statusAtual, 'REBAIXADO', diagnosticResult, {
          aberturaTs: ticketAtivo.aberturaTs,
          rebaixamentoTs: Date.now()
        });
        await redisConfig.client.hset(redisConfig.HASHES.ALERTS, this.sensorName, JSON.stringify(payload));
        logger.info(`📉 [TICKET_MANAGER:${this.sensorName}] Ticket REBAIXADO ${ticketAtivo.ticket} | ${ticketAtivo.status} → ${statusAtual}`);
        return payload;
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
      status,       // Representa o nível atual (Ex: PREDICTIVE_4)
      lifecycle,    // Ciclo de vida da transição (Ex: ABERTO, ESCALONADO, FECHADO)
      ...(diagnosticResult.motivos && { motivos: diagnosticResult.motivos }),
      ...(diagnosticResult.predictive && { predictive: diagnosticResult.predictive }),
      ...timestamps,
      timestamp: Date.now()
    };
  }

  async _buscarStatusFisico() {
    try {
      const raw = await redisConfig.client.hget(redisConfig.HASHES.ENGINE_STATE, this.sensorName);
      if (!raw) return null;
      const estado = JSON.parse(raw);
      return estado.status;
    } catch (err) {
      logger.error(`❌ [TICKET_MANAGER:${this.sensorName}] Falha ao buscar status físico: ${err.message}`);
      return null;
    }
  }
}

module.exports = TicketManager;