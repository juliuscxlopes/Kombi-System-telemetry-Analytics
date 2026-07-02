const deltaCalculator = require('./DeltaCalculator');
const etaCalculator   = require('./ETACalculator');
const classificador   = require('./Classificador');
const metricsSpecs    = require('./metrics_specs.json');
const redisConfig     = require('../../../Infra/Redis/config/redisConfig');
const redisWriter     = require('../../../Infra/Redis/writer/RedisWriterService');
const logger          = require('../../../log/logger');

class ThermalEngineMath {
  constructor() {
    this.NAME   = 'THERMAL_ENGINE_MATH';
    this.janelas = ['30s'];
  }

  async _buscarTicketContext(sensorName) {
    try {
      const raw = await redisConfig.client.hget(redisConfig.HASHES.ALERTS, sensorName);
      if (!raw) return null;

      const ticket = JSON.parse(raw);

      if (!['ABERTO', 'ESCALONADO', 'REBAIXADO'].includes(ticket.lifecycle)) return null;
      if (ticket.valorNaAbertura == null) return null;

      return {
        valorNaAbertura: ticket.valorNaAbertura,
        aberturaTs:      ticket.aberturaTs
      };
    } catch (err) {
      logger.error(`❌ [ThermalEngineMath] Falha ao buscar ticketContext: ${err.message}`);
      return null;
    }
  }

  async processar(sensorName, historicos) {
    logger.debug(`[DEBUG] 🚀 [ThermalEngineMath.processar] Iniciando para sensor: ${sensorName}`);

    const resultado = {
      sensor:          sensorName,
      tsProcessamento: Date.now(),
      janelas:         {},
      diagnostico:     null
    };

    //logger.debug(`[DEBUG] 📖 [ThermalEngineMath] Buscando spec em metrics_specs["${sensorName}"]`);
    const spec = metricsSpecs.metrics_specs[sensorName];
    //logger.debug(`[DEBUG] 🔍 [ThermalEngineMath] Spec encontrada: ${spec ? 'SIM' : 'NÃO (undefined)'}`);

    const ticketContext = await this._buscarTicketContext(sensorName);
    //logger.debug(`[DEBUG] 🎫 [ThermalEngineMath] TicketContext: ${ticketContext ? `valorNaAbertura=${ticketContext.valorNaAbertura}` : 'null'}`);

    for (const janela of this.janelas) {
      const historyPoints = historicos[janela];

      logger.debug(`[DEBUG] ⏱️ [ThermalEngineMath] Analisando janela ${janela} | pontos: ${historyPoints ? historyPoints.length : 0}`);

      if (!historyPoints || historyPoints.length < 2) {
        resultado.janelas[janela] = { disponivel: false };
        continue;
      }

      const valorAtual  = historyPoints[historyPoints.length - 1].value;
      const deltaJanela = deltaCalculator.calcularJanela(historyPoints, valorAtual);
      const eta         = etaCalculator.calcular(valorAtual, deltaJanela.taxaPorMinuto, sensorName);

      resultado.janelas[janela] = {
        sensor:            sensorName,
        janela,
        atual:             deltaJanela.valorAtual,
        delta:             deltaJanela.delta,
        taxaPorMinuto:     deltaJanela.taxaPorMinuto,
        tendencia:         deltaJanela.tendencia,
        txtDelta:          deltaJanela.txtDelta,
        projecoes:         eta.projecoes,
        etaAlertaMinutos:  eta.etaAlertaMinutos,
        etaCriticoMinutos: eta.etaCriticoMinutos,
        limiteAlvo:        eta.limiteAlvo
      };

      if (janela === '30s') {
        //logger.debug(`[DEBUG] ⚙️ [ThermalEngineMath] Calculando delta ticket para 30s`);
        const deltaTicket = deltaCalculator.calcularTicket(
          valorAtual,
          ticketContext?.valorNaAbertura ?? null,
          spec?.delta_ticket
        );

        //logger.debug(`[DEBUG] 🧠 [ThermalEngineMath] Chamando classificador.classificar()`);
        resultado.diagnostico = classificador.classificar(
          sensorName,
          deltaJanela,
          eta,
          deltaTicket
        );

        resultado.diagnostico.deltaTicket = deltaTicket;
        //logger.debug(`[DEBUG] ✅ [ThermalEngineMath] Diagnóstico de 30s concluído com sucesso.`);
      }
    }

    if (!resultado.diagnostico) {
      resultado.diagnostico = {
        nivel:       'TOLERAVEL',
        motivos:     [],
        predictive:  null,
        votos:       {},
        deltaTicket: { delta: null, estado: 'SEM_TICKET' }
      };
      logger.debug(`🟢 [MATH:${sensorName}] Diagnóstico padrão — janela 30s indisponível.`);
    }

// 🔵 PAYLOAD ESTRUTURADO — { sensor, ts, metrics: { janelas, diagnostico } }
    const payload = {
      sensor: sensorName,
      ts:     resultado.tsProcessamento,
      metrics: {
        janelas:     resultado.janelas,
        diagnostico: resultado.diagnostico
      }
    };

    // 🔵 EMISSOR PRÓPRIO DO THERMAL — HSET + Stream + Pub/Sub
    await redisWriter.write({
      hashKey:   redisConfig.HASHES.METRICS,
      field:     sensorName,
      streamKey: redisConfig.STREAMS.LOG,
      channel:   redisConfig.CHANNELS.TELEMETRY,
      tipo:      'TELEMETRY',
      payload
    });

    logger.debug(`[DEBUG] 🏁 [ThermalEngineMath.processar] Finalizado processamento para ${sensorName}`);
    return resultado; // função continua retornando o resultado "cru", sem envelope, pro resto do pipeline usar como já usa
  }
}

module.exports = new ThermalEngineMath();