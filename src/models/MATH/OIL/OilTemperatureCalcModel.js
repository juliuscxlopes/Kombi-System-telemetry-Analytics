// src/models/MATH/OIL/OilTemperatureCalcModel.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const publisherService = require('../../../Infra/Redis/Publisher/PublisherService'); // Injetado para o subscribe

class OilTemperatureCalcModel {
  constructor() {
    this.NAME = 'OIL_TEMP_CALC';
    this.HISTORY_WINDOW_MS = 60000; // 1 minuto configurado no domínio do cálculo
  }

  /**
   * MÉTODO PRINCIPAL: O fluxo morre aqui nutrindo a stream e sem dar return
   */
  async processar(sensorName, initialValue, initialGlobalState) {
    try {
      // 1. Busca os dados necessários (Histórico via XRANGE + Fresh Check)
      const { historyPoints, currentVal, globalState } = await this._buscarDados(sensorName, initialValue, initialGlobalState);

      // 2. Executa a matemática termo-cinética baseada no que coletou
      const metrics = this._executarMatematica(historyPoints, currentVal);

      // 3. 🚀 NUTRE A STREAM HEALTH COM O PAYLOAD FINAL (Sem return)
      publisherService.health(
        sensorName,
        {
          value: currentVal,
          delta: metrics.delta,
          taxaSubidaPorMinuto: metrics.taxaSubidaPorMinuto,
          tendencia: metrics.tendencia,
          txtDelta: metrics.txtDelta
        },
        {} // Diagnosis vazio por hora, esperando o seu plano para a Spec
      );
      // RETORNA o objeto com as métricas para o orquestrador
      return {
          value: currentVal,
          delta: metrics.delta,
          taxaSubidaPorMinuto: metrics.taxaSubidaPorMinuto,
          tendencia: metrics.tendencia,
          txtDelta: metrics.txtDelta
        };

    } catch (err) {
      console.error(`❌ [${this.NAME}] Erro ao processar pipeline de cálculo:`, err.message);
      throw err;
    }
  }

  /**
   * MÉTODO AUXILIAR 1: Responsável por garantir o dado mais fresco possível do motor
   */
  async _buscarDados(sensorName, initialValue, initialGlobalState) {
    // 1. Calcula a janela de tempo e busca direto na Stream via Redis
    const agora = Date.now();
    const umMinutoAtras = agora - this.HISTORY_WINDOW_MS;
    
    // Busca os registros do último minuto na stream de telemetria do motor
    const registrosStream = await redisConfig.client.xrange('stream:engine', umMinutoAtras, agora);
    
    // Faz o parse dos pontos históricos para o formato que a matemática espera
    const historyPoints = (registrosStream || []).map(([id, campos]) => {
      const payloadIdx = campos.indexOf('payload');
      if (payloadIdx === -1) return null;
      try {
        const dados = JSON.parse(campos[payloadIdx + 1]);
        // Filtra para garantir que estamos pegando o histórico apenas DESTE sensor específico
        if (dados.sensor === sensorName) {
          return { value: dados.value, ts: parseInt(dados.ts || id.split('-')[0]) };
        }
      } catch (e) {
        return null;
      }
      return null;
    }).filter(ponto => ponto !== null);

    // 2. FRESH CHECK: Lê o estado atual imediato da Hash do Redis
    const freshState = await redisConfig.client.hgetall('kombi:engine:state');
    
    let currentVal = initialValue;
    let globalState = freshState || initialGlobalState;

    if (freshState && freshState[sensorName]) {
      currentVal = JSON.parse(freshState[sensorName]).value;
    }

    return { historyPoints, currentVal, globalState };
  }

  /**
   * MÉTODO AUXILIAR 2: Matemática pura aplicada sobre os dados isolados
   */
  _executarMatematica(historyPoints, currentVal) {
    if (!historyPoints || historyPoints.length < 2) {
      return {
        delta: 0,
        taxaSubidaPorMinuto: 0,
        tendencia: 'ESTAVEL',
        txtDelta: 'Calculando...'
      };
    }

    const last = { value: currentVal, ts: Date.now() };
    const first = historyPoints[0];

    // Cálculo baseado no tempo real decorrido na janela (em minutos)
    const deltaTempoMinutos = (last.ts - first.ts) / 60000;
    const divisorTempo = deltaTempoMinutos > 0 ? deltaTempoMinutos : 0.016; // mínimo 1s

    // Derivada Térmica por minuto útil
    const deltaValue = last.value - first.value;
    const taxaSubidaPorMinuto = deltaValue / divisorTempo;

    // 🔮 PREDITIVIDADE: Onde o valor vai estar daqui a 2 minutos se o motor continuar nessa rampa?
    const TEMPO_PROJECAO_MINUTOS = 2;
    const projecaoValor = currentVal + (taxaSubidaPorMinuto * TEMPO_PROJECAO_MINUTOS);

    // Classificação baseada na física do motor a ar
    let tendencia = 'ESTAVEL';
    if (taxaSubidaPorMinuto > 2.0) tendencia = 'SUBINDO_RAPIDO';
    else if (taxaSubidaPorMinuto > 0.5) tendencia = 'SUBINDO';
    else if (taxaSubidaPorMinuto < -0.5) tendencia = 'DESCENDO';

    return {
      delta: parseFloat(deltaValue.toFixed(1)),
      taxaSubidaPorMinuto: parseFloat(taxaSubidaPorMinuto.toFixed(2)),
      tendencia,
      txtDelta: `${deltaValue > 0 ? '+' : ''}${deltaValue.toFixed(1)}°C em ${parseFloat(divisorTempo.toFixed(1))} min`
    };
  }
}

module.exports = new OilTemperatureCalcModel();