const deltaCalculator = require('./DeltaCalculator');
const etaCalculator   = require('./ETACalculator');
const classificador   = require('./Classificador');
const metricsSpecs    = require('./metrics_specs.json');
const logger          = require('../../../log/logger');

class ThermalEngineMath {
  constructor() {
    this.NAME   = 'THERMAL_ENGINE_MATH';
    this.janelas = ['30s'];
  }

  /**
   * @param {String} sensorName
   * @param {Object} historicos      — { '30s': [], '1m': [], ... }
   * @param {Object} ticketContext   — { valorNaAbertura, aberturaTs } | null
   */
  processar(sensorName, historicos, ticketContext = null) {
    logger.debug(`[DEBUG] 🚀 [ThermalEngineMath.processar] Iniciando para sensor: ${sensorName}`);
    
    const resultado = {
      sensor:        sensorName,
      tsProcessamento: Date.now(),
      janelas:       {},
      diagnostico:   null
    };

    logger.debug(`[DEBUG] 📖 [ThermalEngineMath] Buscando spec em metrics_specs.metrics_specs["${sensorName}"]`);
    const spec = metricsSpecs.metrics_specs[sensorName];
    logger.debug(`[DEBUG] 🔍 [ThermalEngineMath] Spec encontrada: ${spec ? 'SIM' : 'NÃO (undefined)'}`);

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
        sensor:             sensorName,
        janela,
        atual:              valorAtual,
        delta:              deltaJanela.delta,
        taxaPorMinuto:      deltaJanela.taxaPorMinuto,
        tendencia:          deltaJanela.tendencia,
        txtDelta:           deltaJanela.txtDelta,
        projecoes:          eta.projecoes,
        etaAlertaMinutos:   eta.etaAlertaMinutos,
        etaCriticoMinutos:  eta.etaCriticoMinutos,
        limiteAlvo:         eta.limiteAlvo
      };

      // Diagnóstico na janela de 30s — mais reativo
      if (janela === '30s') {
        logger.debug(`[DEBUG] ⚙️ [ThermalEngineMath] Calculando delta ticket para 30s`);
        const deltaTicket = deltaCalculator.calcularTicket(
          valorAtual,
          ticketContext?.valorNaAbertura ?? null,
          spec?.delta_ticket
        );

        logger.debug(`[DEBUG] 🧠 [ThermalEngineMath] Chamando classificador.classificar()`);
        resultado.diagnostico = classificador.classificar(
          sensorName,
          deltaJanela,
          eta,
          deltaTicket
        );

        resultado.diagnostico.deltaTicket = deltaTicket;
        logger.debug(`[DEBUG] ✅ [ThermalEngineMath] Diagnóstico de 30s concluído com sucesso.`);
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

    logger.debug(`[DEBUG] 🏁 [ThermalEngineMath.processar] Finalizado processamento para ${sensorName}`);
    return resultado;
  }
}

module.exports = new ThermalEngineMath();