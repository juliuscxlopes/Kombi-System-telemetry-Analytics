// src/models/MATH/ETACalculator.js
const engine_Specs = require('../engine_Specs.json');

class ETACalculator {

  /**
   * DIMENSÃO 2 — Projeção futura
   * Calcula tempo para atingir limites físicos e projeções em 30s/1m/3m/5m
   */
  calcular(valorAtual, taxaPorMinuto, sensorName) {
    const spec = engine_Specs.specs[sensorName];

    const projecoes = {
      em30s:     parseFloat((valorAtual + taxaPorMinuto * 0.5).toFixed(1)),
      em1Minuto: parseFloat((valorAtual + taxaPorMinuto * 1).toFixed(1)),
      em3Minutos: parseFloat((valorAtual + taxaPorMinuto * 3).toFixed(1)),
      em5Minutos: parseFloat((valorAtual + taxaPorMinuto * 5).toFixed(1))
    };

    if (!spec || taxaPorMinuto <= 0) {
      return {
        projecoes,
        etaAlertaMinutos:  null,
        etaCriticoMinutos: null,
        mensagem: 'Estável ou resfriando.',
        limiteAlvo: spec ? { alerta: spec.ALERTA_THRESHOLD, critico: spec.CRITICO_THRESHOLD } : null
      };
    }

    const minutosParaAlerta  = (spec.ALERTA_THRESHOLD  - valorAtual) / taxaPorMinuto;
    const minutosParaCritico = (spec.CRITICO_THRESHOLD - valorAtual) / taxaPorMinuto;

    return {
      projecoes,
      etaAlertaMinutos:  minutosParaAlerta  > 0 ? parseFloat(minutosParaAlerta.toFixed(2))  : 0,
      etaCriticoMinutos: minutosParaCritico > 0 ? parseFloat(minutosParaCritico.toFixed(2)) : 0,
      limiteAlvo: {
        alerta:  spec.ALERTA_THRESHOLD,
        critico: spec.CRITICO_THRESHOLD
      }
    };
  }
}

module.exports = new ETACalculator();