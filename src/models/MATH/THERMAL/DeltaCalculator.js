const logger = require('../../../log/logger');

class DeltaCalculator {

  /**
   * DIMENSÃO 1 — Velocidade atual
   * Calcula delta, taxa por minuto e tendência sobre a janela histórica
   */
  calcularJanela(historyPoints, valorAtual) {
    const last  = { value: valorAtual, ts: Date.now() };
    const first = historyPoints[0];

    logger.debug(`[DEBUG_DELTA] 📊 [DeltaCalculator] Cálculo de Janela | Valor Inicial: ${first.value} (ts: ${first.ts}) | Valor Atual: ${last.value} (ts: ${last.ts})`);

    const deltaTempoMinutos = (last.ts - first.ts) / 60000;
    const divisor           = deltaTempoMinutos > 0 ? deltaTempoMinutos : 0.016;

    const deltaValue    = last.value - first.value;
    const taxaPorMinuto = deltaValue / divisor;

    logger.debug(`[DEBUG_DELTA] ⏱️ [DeltaCalculator] Delta Tempo (Min): ${deltaTempoMinutos.toFixed(4)} | Divisor Utilizado: ${divisor.toFixed(4)}`);
    logger.debug(`[DEBUG_DELTA] 📈 [DeltaCalculator] Delta Valor: ${deltaValue.toFixed(2)}°C | Taxa Calculada: ${taxaPorMinuto.toFixed(2)}°C/min`);

    // DESCENDO_RAPIDO espelha simetricamente o limiar de PREDICTIVE_1
    // — o que sobe rápido o suficiente pra acionar P1 descendo confirma contenção
    let tendencia = 'ESTAVEL';
    if      (taxaPorMinuto >  2.0) tendencia = 'SUBINDO_RAPIDO';
    else if (taxaPorMinuto >  0.5) tendencia = 'SUBINDO';
    else if (taxaPorMinuto < -2.0) tendencia = 'DESCENDO_RAPIDO';
    else if (taxaPorMinuto < -0.5) tendencia = 'DESCENDO';

    const sinal = deltaValue > 0 ? '+' : '';

    const resultado = {
      valorAtual,                                        // ← exposto para o Classificador checar NOMINAL_MIN
      delta:         parseFloat(deltaValue.toFixed(1)),
      taxaPorMinuto: parseFloat(taxaPorMinuto.toFixed(2)),
      tendencia,
      txtDelta: `${sinal}${deltaValue.toFixed(1)}°C em ${divisor.toFixed(1)} min`
    };

    logger.debug(`[DEBUG_DELTA] 🏁 [DeltaCalculator] Resultado Janela: ${JSON.stringify(resultado)} | Tendência: ${tendencia}`);
    return resultado;
  }

  /**
   * DIMENSÃO 3 — Eficácia da contenção
   * Calcula variação desde abertura do ticket (double check)
   * valorNaAbertura vem do payload persistido no Redis pelo TicketManager no momento ABERTO
   *
   * @param {Number} valorAtual
   * @param {Number} valorNaAbertura  — persistido pelo TicketManager na abertura do ticket
   * @param {Object} deltaTicketSpec  — thresholds do delta_ticket da metrics_specs
   */
  calcularTicket(valorAtual, valorNaAbertura, deltaTicketSpec) {
    logger.debug(`[DEBUG_TICKET] 🎫 [DeltaCalculator] Calculando Ticket | Valor Atual: ${valorAtual} | Valor Abertura: ${valorNaAbertura}`);

    if (valorNaAbertura === null || valorNaAbertura === undefined) {
      logger.debug(`[DEBUG_TICKET] 🎫 [DeltaCalculator] Ticket ignorado: sem valor na abertura.`);
      return { delta: null, estado: 'SEM_TICKET' };
    }

    if (!deltaTicketSpec) {
      logger.warn(`[DEBUG_TICKET] ⚠️ [DeltaCalculator] deltaTicketSpec ausente — retornando SEM_TICKET.`);
      return { delta: null, estado: 'SEM_TICKET' };
    }

    const delta = parseFloat((valorAtual - valorNaAbertura).toFixed(1));

    let estado = 'SAUDAVEL';
    if      (delta >= deltaTicketSpec.CRITICO)  estado = 'CRITICO';
    else if (delta >= deltaTicketSpec.PIORANDO) estado = 'PIORANDO';
    else if (delta >= deltaTicketSpec.ESTAVEL)  estado = 'ESTAVEL';

    logger.debug(`[DEBUG_TICKET] 🎫 [DeltaCalculator] Ticket Delta: ${delta} | Estado: ${estado}`);
    return { delta, estado };
  }
}

module.exports = new DeltaCalculator();