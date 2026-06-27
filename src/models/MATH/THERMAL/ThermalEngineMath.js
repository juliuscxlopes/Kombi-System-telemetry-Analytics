// src/models/MATH/ThermalEngineMath.js
const engineSpecs = require('./engine_Specs.json');
const metricsSpecs = require('./metrics_specs.json');
const logger = require('../../../log/logger');

class ThermalEngineMath {
  constructor() {
    this.NAME = 'THERMAL_ENGINE_MATH';
    this.janelas = ['30s', '1m', '3m', '5m'];
  }

  processar(sensorName, historicos) {
    //logger.debug(`🧮 [MATH] Iniciando processamento | Sensor: ${sensorName}`);

    const resultado = {
      sensor: sensorName,
      tsProcessamento: Date.now(),
      janelas: {},
      diagnostico: null
    };

    for (const janela of this.janelas) {
      const historyPoints = historicos[janela];

      if (!historyPoints || historyPoints.length < 2) {
        resultado.janelas[janela] = { disponivel: false };
        logger.debug(`⏭️  [MATH:${sensorName}] Janela ${janela} — insuficiente (${historyPoints?.length ?? 0} pontos)`);
        continue;
      }

      const valorAtual = historyPoints[historyPoints.length - 1].value;
      const metricas = this._calcularMetricas(historyPoints, valorAtual, sensorName, janela);
      resultado.janelas[janela] = metricas;

      //logger.debug(`📊 [MATH:${sensorName}] Janela ${janela} | Atual: ${valorAtual}°C | Taxa: ${metricas.taxaSubidaPorMinuto}°C/min | Tendência: ${metricas.tendencia} | Projeção 1m: ${metricas.projecao.em1Minuto}°C | ETA Alerta: ${metricas.etaParaLimites.alertaMinutos ?? 'N/A'}min | ETA Crítico: ${metricas.etaParaLimites.criticoMinutos ?? 'N/A'}min`);

      if (janela === '1m') {
        resultado.diagnostico = this._classificar(sensorName, metricas);
        logger.info(`🩺 [MATH:${sensorName}] Diagnóstico 1m | Severidade: ${resultado.diagnostico.severidade} | Motivos: ${resultado.diagnostico.motivos.join(' | ') || 'nenhum'} | Predictive: ${resultado.diagnostico.predictive?.tipo ?? 'null'}`);
      }
    }

    if (!resultado.diagnostico) {
      resultado.diagnostico = {
        severidade: 'TOLERAVEL',
        motivos: [],
        predictive: null,
        janela: '1m',
        timestamp: Date.now()
      };
      logger.debug(`🟢 [MATH:${sensorName}] Diagnóstico padrão — sem janela 1m disponível.`);
    }

    return resultado;
  }

  _calcularMetricas(historyPoints, valorAtual, sensorName, janela) {
    const derivada = this._calcularDerivada(historyPoints, valorAtual);
    const taxaSubida = derivada.taxaSubidaPerMinute;

    const projecoes = {
      em1Minuto:  parseFloat((valorAtual + taxaSubida * 1).toFixed(1)),
      em2Minutos: parseFloat((valorAtual + taxaSubida * 2).toFixed(1)),
      em5Minutos: parseFloat((valorAtual + taxaSubida * 5).toFixed(1))
    };

    const etaParaLimites = this._calcularETA(valorAtual, taxaSubida, sensorName);

    return {
      sensor: sensorName,
      janela,
      atual: valorAtual,
      deltaUltimoMinuto: derivada.delta,
      taxaSubidaPorMinuto: taxaSubida,
      tendencia: derivada.tendencia,
      projecao: projecoes,
      etaParaLimites,
      txtDelta: derivada.txtDelta
    };
  }

  _classificar(sensorName, metricas) {
    const spec = metricsSpecs.metrics_specs[sensorName];
    if (!spec) {
      logger.warn(`⚠️  [MATH:${sensorName}] Spec métrica não encontrada — retornando TOLERAVEL.`);
      return { severidade: 'TOLERAVEL', motivos: [], predictive: null };
    }

    const projecao1m  = metricas.projecao.em1Minuto;
    const specFisica  = engineSpecs.specs[sensorName];
    const predictSpec = spec.predictive;

    let severidade = 'TOLERAVEL';
    const motivos = [];

    const checar = (valor, limites, label) => {
      if (valor >= limites.CRITICO) {
        severidade = 'CRITICO';
        motivos.push(`${label}: ${valor} ≥ ${limites.CRITICO} (CRITICO)`);
      } else if (valor >= limites.ALERTA && severidade !== 'CRITICO') {
        severidade = 'ALERTA';
        motivos.push(`${label}: ${valor} ≥ ${limites.ALERTA} (ALERTA)`);
      }
    };

    checar(metricas.taxaSubidaPorMinuto, spec.taxa_subida, 'taxa_subida');
    checar(metricas.deltaUltimoMinuto,   spec.delta,       'delta');
    checar(projecao1m,                   spec.projecao_1m, 'projecao_1m');

    let predictive = null;

    if (projecao1m >= specFisica.CRITICO_THRESHOLD) {
      predictive = {
        tipo: 'PREDICTIVE_2',
        actuator: predictSpec.PREDICTIVE_2.actuator,
        intensity: predictSpec.PREDICTIVE_2.intensity,
        description: predictSpec.PREDICTIVE_2.description
      };
      //logger.warn(`⚡ [MATH:${sensorName}] PREDICTIVE_2 — projeção ${projecao1m}°C ≥ CRITICO ${specFisica.CRITICO_THRESHOLD}°C`);
    } else if (projecao1m >= specFisica.ALERTA_THRESHOLD) {
      predictive = {
        tipo: 'PREDICTIVE_1',
        actuator: predictSpec.PREDICTIVE_1.actuator,
        intensity: predictSpec.PREDICTIVE_1.intensity,
        description: predictSpec.PREDICTIVE_1.description
      };
      //logger.warn(`⚡ [MATH:${sensorName}] PREDICTIVE_1 — projeção ${projecao1m}°C ≥ ALERTA ${specFisica.ALERTA_THRESHOLD}°C`);
    }

    return {
      severidade,
      motivos,
      predictive,
      janela: '1m',
      timestamp: Date.now()
    };
  }

  _calcularDerivada(historyPoints, currentVal) {
    const last  = { value: currentVal, ts: Date.now() };
    const first = historyPoints[0];

    const deltaTempoMinutos = (last.ts - first.ts) / 60000;
    const divisor = deltaTempoMinutos > 0 ? deltaTempoMinutos : 0.016;

    const deltaValue = last.value - first.value;
    const taxaSubidaPorMinuto = deltaValue / divisor;

    let tendencia = 'ESTAVEL';
    if (taxaSubidaPorMinuto > 2.0)       tendencia = 'SUBINDO_RAPIDO';
    else if (taxaSubidaPorMinuto > 0.5)  tendencia = 'SUBINDO';
    else if (taxaSubidaPorMinuto < -0.5) tendencia = 'DESCENDO';

    const sinal = deltaValue > 0 ? '+' : '';

    return {
      delta: parseFloat(deltaValue.toFixed(1)),
      taxaSubidaPerMinute: parseFloat(taxaSubidaPorMinuto.toFixed(2)),
      tendencia,
      txtDelta: `${sinal}${deltaValue.toFixed(1)}°C em ${divisor.toFixed(1)} min`
    };
  }

  _calcularETA(currentVal, taxaSubida, sensorName) {
    const spec = engineSpecs.specs[sensorName];
    if (!spec || taxaSubida <= 0) {
      return { alertaMinutos: null, criticoMinutos: null, mensagem: 'Estável ou resfriando.' };
    }

    const minutosParaAlerta  = (spec.ALERTA_THRESHOLD  - currentVal) / taxaSubida;
    const minutosParaCritico = (spec.CRITICO_THRESHOLD - currentVal) / taxaSubida;

    return {
      alertaMinutos:  minutosParaAlerta  > 0 ? parseFloat(minutosParaAlerta.toFixed(2))  : 0,
      criticoMinutos: minutosParaCritico > 0 ? parseFloat(minutosParaCritico.toFixed(2)) : 0,
      limiteAlvo: {
        alerta:  spec.ALERTA_THRESHOLD,
        critico: spec.CRITICO_THRESHOLD
      }
    };
  }
}

module.exports = new ThermalEngineMath();