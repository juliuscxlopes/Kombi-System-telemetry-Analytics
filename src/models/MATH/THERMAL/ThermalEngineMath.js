// src/models/MATH/ThermalEngineMath.js
const specThermalLimits = require('../../Specs/SpecThermalLimits'); // Contrato de limites físicos

class ThermalEngineMath {
  constructor() {
    // Construtor puramente estático e desacoplado.
  }

  /**
   * MÉTODO PADRÃO DE ENTRADA (Contrato)
   * @param {Array} historyPoints - Array com histórico de pontos estruturados: [{ value, ts }, ...]
   * @param {Number} currentVal - Leitura atual do sensor.
   * @param {String} sensorName - Nome do sensor térmico (ex: 'OIL_TEMP', 'CHT').
   */
  analisar(historyPoints, currentVal, sensorName = 'OIL_TEMP') {
    // 1. Cálculo da Derivada Térmica (Taxa de subida por minuto)
    const metricasDerivada = this._calcularDerivada(historyPoints, currentVal); 
    
    // 2. Projeção Preditiva (ETA Térmico)
    const taxaSubida = metricasDerivada.taxaSubidaPerMinute;
    
    const projecoes = {
      em1Minuto: parseFloat((currentVal + (taxaSubida * 1)).toFixed(1)),
      em2Minutos: parseFloat((currentVal + (taxaSubida * 2)).toFixed(1)),
      em5Minutos: parseFloat((currentVal + (taxaSubida * 5)).toFixed(1))
    };

    // 3. Tempo Restante (ETA) para atingir os limites físicos da Spec (Genérico para qualquer sensor térmico)
    const etaLimites = this._calcularTempoParaLimites(currentVal, taxaSubida, sensorName);

    return {
      sensor: sensorName,
      atual: currentVal,
      deltaUltimoMinuto: metricasDerivada.delta,
      taxaSubidaPorMinuto: taxaSubida,
      tendencia: metricasDerivada.tendencia,
      projecao: projecoes,
      etaParaLimites: etaLimites,
      txtDelta: metricasDerivada.txtDelta
    };
  }

  /**
   * 📉 Derivada Térmica (Taxa de Variação)
   * Avalia a inércia térmica a partir dos pontos de histórico passados pelo Orquestrador.
   */
  _calcularDerivada(historyPoints, currentVal) {
    // Contrato mínimo exigido: pelo menos 2 pontos para formar uma reta de variação
    if (!historyPoints || historyPoints.length < 2) {
      return {
        delta: 0,
        taxaSubidaPerMinute: 0,
        tendencia: 'ESTAVEL',
        txtDelta: 'Aguardando amostragem...'
      };
    }

    const last = { value: currentVal, ts: Date.now() };
    const first = historyPoints[0];

    const deltaTempoMinutos = (last.ts - first.ts) / 60000;
    // Evita divisão por zero caso ocorram no mesmo milissegundo; assume intervalo mínimo de ~1s
    const divisorTempo = deltaTempoMinutos > 0 ? deltaTempoMinutos : 0.016; 

    const deltaValue = last.value - first.value;
    const taxaSubidaPorMinuto = deltaValue / divisorTempo;

    let tendencia = 'ESTAVEL';
    if (taxaSubidaPorMinuto > 2.0) tendencia = 'SUBINDO_RAPIDO';
    else if (taxaSubidaPorMinuto > 0.5) tendencia = 'SUBINDO';
    else if (taxaSubidaPorMinuto < -0.5) tendencia = 'DESCENDO';

    const sinalDelta = deltaValue > 0 ? '+' : '';
    const txtDeltaFormatado = `${sinalDelta}${deltaValue.toFixed(1)}°C em ${parseFloat(divisorTempo.toFixed(1))} min`;

    return {
      delta: parseFloat(deltaValue.toFixed(1)),
      taxaSubidaPerMinute: parseFloat(taxaSubidaPorMinuto.toFixed(2)),
      tendencia,
      txtDelta: txtDeltaFormatado
    };
  }

  /**
   * ⏱️ Calcula o tempo (minutos) para atingir os limites físicos (Alerta/Crítico)
   * Obtendo os limiares dinamicamente da Spec dependendo do `sensorName` ('OIL_TEMP', 'CHT', etc.).
   */
  _calcularTempoParaLimites(currentVal, taxaSubida, sensorName) {
    // Busca os limites dinâmicos na spec (Ex: Pega os ranges de ALERTA e CRITICO)
    const limitesSensor = specThermalLimits.obterLimites ? specThermalLimits.obterLimites(sensorName) : null;

    // Fallback de segurança caso a Spec não encontre o sensor ou não esteja implementada ainda
    const thresholdAlerta = limitesSensor?.ALERTA || 95.0;
    const thresholdCritico = limitesSensor?.CRITICO || 100.0;

    // Se a temperatura estiver estável ou caindo, o ETA para estourar o limite é nulo/infinito
    if (taxaSubida <= 0) {
      return {
        alertaMinutos: null,
        criticoMinutos: null,
        mensagem: 'Parâmetros térmicos controlados ou em resfriamento.'
      };
    }

    // Cálculo do tempo restante (Minutos = Distância para o limite / Taxa de subida por minuto)
    const minutosParaAlerta = (thresholdAlerta - currentVal) / taxaSubida;
    const minutosParaCritico = (thresholdCritico - currentVal) / taxaSubida;

    return {
      alertaMinutos: minutosParaAlerta > 0 ? parseFloat(minutosParaAlerta.toFixed(2)) : 0,
      criticoMinutos: minutosParaCritico > 0 ? parseFloat(minutosParaCritico.toFixed(2)) : 0,
      limiteAlvo: { alerta: thresholdAlerta, critico: thresholdCritico }
    };
  }
}

module.exports = new ThermalEngineMath();