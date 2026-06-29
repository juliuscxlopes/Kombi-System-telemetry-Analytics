// src/models/MATH/DeltaCalculator.js
class DeltaCalculator {

  /**
   * DIMENSÃO 1 — Velocidade atual
   * Calcula delta, taxa por minuto e tendência sobre a janela histórica
   */
  calcularJanela(historyPoints, valorAtual) {
    const last  = { value: valorAtual, ts: Date.now() };
    const first = historyPoints[0];

    const deltaTempoMinutos = (last.ts - first.ts) / 60000;
    const divisor = deltaTempoMinutos > 0 ? deltaTempoMinutos : 0.016;

    const deltaValue = last.value - first.value;
    const taxaPorMinuto = deltaValue / divisor;

    let tendencia = 'ESTAVEL';
    if (taxaPorMinuto > 2.0)       tendencia = 'SUBINDO_RAPIDO';
    else if (taxaPorMinuto > 0.5)  tendencia = 'SUBINDO';
    else if (taxaPorMinuto < -0.5) tendencia = 'DESCENDO';

    const sinal = deltaValue > 0 ? '+' : '';

    return {
      delta:          parseFloat(deltaValue.toFixed(1)),
      taxaPorMinuto:  parseFloat(taxaPorMinuto.toFixed(2)),
      tendencia,
      txtDelta: `${sinal}${deltaValue.toFixed(1)}°C em ${divisor.toFixed(1)} min`
    };
  }

  /**
   * DIMENSÃO 3 — Eficácia da contenção
   * Calcula variação desde abertura do ticket (double check)
   * @param {Number} valorAtual
   * @param {Number} valorNaAbertura — valor do sensor quando o ticket foi aberto
   * @param {Object} deltaTicketSpec — thresholds do delta_ticket da metrics_specs
   */
  calcularTicket(valorAtual, valorNaAbertura, deltaTicketSpec) {
    if (valorNaAbertura === null || valorNaAbertura === undefined) {
      return { delta: null, estado: 'SEM_TICKET' };
    }

    const delta = parseFloat((valorAtual - valorNaAbertura).toFixed(1));

    let estado = 'SAUDAVEL';
    if (delta >= deltaTicketSpec.CRITICO) {
      estado = 'CRITICO';
    } else if (delta >= deltaTicketSpec.PIORANDO) {
      estado = 'PIORANDO';
    } else if (delta >= deltaTicketSpec.ESTAVEL) {
      estado = 'ESTAVEL';
    }

    return { delta, estado };
  }
}

module.exports = new DeltaCalculator();