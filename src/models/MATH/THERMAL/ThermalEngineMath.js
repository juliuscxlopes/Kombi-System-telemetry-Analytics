// src/models/MATH/ThermalEngineMath.js
const deltaCalculator = require('./DeltaCalculator');
const etaCalculator   = require('./ETACalculator');
const classificador   = require('./Classificador');
const metricsSpecs    = require('./metrics_specs.json');
const logger          = require('../../../log/logger');

class ThermalEngineMath {
  constructor() {
    this.NAME   = 'THERMAL_ENGINE_MATH';
    this.janelas = ['30s', '1m', '3m', '5m'];
  }

  /**
   * @param {String} sensorName
   * @param {Object} historicos      — { '30s': [], '1m': [], ... }
   * @param {Object} ticketContext   — { valorNaAbertura, aberturaTs } | null
   */
  processar(sensorName, historicos, ticketContext = null) {
    const resultado = {
      sensor:          sensorName,
      tsProcessamento: Date.now(),
      janelas:         {},
      diagnostico:     null
    };

    const spec = metricsSpecs.metrics_specs[sensorName];

    for (const janela of this.janelas) {
      const historyPoints = historicos[janela];

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
        const deltaTicket = deltaCalculator.calcularTicket(
          valorAtual,
          ticketContext?.valorNaAbertura ?? null,
          spec?.delta_ticket
        );

        resultado.diagnostico = classificador.classificar(
          sensorName,
          deltaJanela,
          eta,
          deltaTicket
        );

        resultado.diagnostico.deltaTicket = deltaTicket;
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

    return resultado;
  }
}

module.exports = new ThermalEngineMath();