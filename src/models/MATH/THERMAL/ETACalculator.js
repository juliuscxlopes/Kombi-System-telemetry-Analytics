const engine_Specs = require('./engine_Specs.json');
const logger = require('../../../log/logger');

class ETACalculator {

  /**
   * DIMENSÃO 2 — Projeção futura
   * Calcula tempo para atingir limites físicos e projeções em 30s/1m/3m/5m
   */
  calcular(valorAtual, taxaPorMinuto, sensorName) {
    logger.debug(`[DEBUG_ETA] 🌡️ [ETACalculator] Iniciando cálculo | Sensor: ${sensorName} | Valor Atual: ${valorAtual} | Taxa/Min: ${taxaPorMinuto}`);
    
    const spec = engine_Specs.specs[sensorName];

    const projecoes = {
      em30s:      parseFloat((valorAtual + taxaPorMinuto * 0.5).toFixed(1)),
      //em1Minuto:  parseFloat((valorAtual + taxaPorMinuto * 1).toFixed(1)),
    };

    logger.debug(`[DEBUG_ETA] 🔮 [ETACalculator] Projeções calculadas: ${JSON.stringify(projecoes)}`);

    if (!spec || taxaPorMinuto <= 0) {
      logger.debug(`[DEBUG_ETA] ⏸️ [ETACalculator] Taxa <= 0 ou spec ausente. Retornando cenário estável/resfriando.`);
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

    logger.debug(`[DEBUG_ETA] ⏱️ [ETACalculator] Limiares configurados | Alerta: ${spec.ALERTA_THRESHOLD} | Crítico: ${spec.CRITICO_THRESHOLD}`);
    logger.debug(`[DEBUG_ETA] ⏱️ [ETACalculator] Minutos calculados | Para Alerta: ${minutosParaAlerta.toFixed(4)} | Para Crítico: ${minutosParaCritico.toFixed(4)}`);

    const resultado = {
      projecoes,
      etaAlertaMinutos:  minutosParaAlerta  > 0 ? parseFloat(minutosParaAlerta.toFixed(2))  : 0,
      etaCriticoMinutos: minutosParaCritico > 0 ? parseFloat(minutosParaCritico.toFixed(2)) : 0,
      limiteAlvo: {
        alerta:  spec.ALERTA_THRESHOLD,
        critico: spec.CRITICO_THRESHOLD
      }
    };

    logger.debug(`[DEBUG_ETA] 🏁 [ETACalculator] Resultado final: ${JSON.stringify(resultado)}`);
    return resultado;
  }
}

module.exports = new ETACalculator();