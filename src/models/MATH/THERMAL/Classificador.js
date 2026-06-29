// src/models/MATH/Classificador.js
const engineSpecs  = require('../engine_Specs.json');
const metricsSpecs = require('../metrics_specs.json');
const logger = require('../../../../log/logger');

class Classificador {

  /**
   * Sistema de votação entre 3 dimensões independentes
   * @param {String} sensorName
   * @param {Object} deltaJanela    — resultado do DeltaCalculator.calcularJanela()
   * @param {Object} eta            — resultado do ETACalculator.calcular()
   * @param {Object} deltaTicket    — resultado do DeltaCalculator.calcularTicket()
   */
  classificar(sensorName, deltaJanela, eta, deltaTicket) {
    const spec      = metricsSpecs.metrics_specs[sensorName];
    const specFisica = engineSpecs.specs[sensorName];

    if (!spec) {
      logger.warn(`⚠️  [CLASSIFICADOR:${sensorName}] Spec não encontrada.`);
      return { nivel: 'TOLERAVEL', motivos: [], predictive: null, votos: {} };
    }

    // ── VOTAÇÃO DAS 3 DIMENSÕES ───────────────────────────────

    const votos = {
      taxa:         this._votarTaxa(deltaJanela.taxaPorMinuto, spec.taxa_subida),
      delta_janela: this._votarTaxa(deltaJanela.delta, spec.delta_janela),
      projecao:     this._votarProjecao(eta.projecoes.em30s, spec.projecao_30s),
      delta_ticket: deltaTicket.estado ?? 'SEM_TICKET'
    };

    // ── NÍVEL FINAL — mínimo 2 votos concordando ─────────────
    const nivel = this._resolverNivel(votos, deltaTicket);
    const motivos = this._montarMotivos(votos, deltaJanela, eta, deltaTicket);

    // ── PREDICTIVE — só se houver nível ──────────────────────
    let predictive = null;
    if (nivel !== 'TOLERAVEL' && spec.predictive[nivel]) {
      predictive = {
        tipo:        nivel,
        actuator:    spec.predictive[nivel].actuator,
        intensity:   spec.predictive[nivel].intensity,
        description: spec.predictive[nivel].description
      };
    }

    logger.info(`🩺 [CLASSIFICADOR:${sensorName}] Nível: ${nivel} | Votos: taxa=${votos.taxa} proj=${votos.projecao} ticket=${votos.delta_ticket} | Predictive: ${predictive?.tipo ?? 'null'}`);

    return { nivel, motivos, predictive, votos };
  }

  _votarTaxa(valor, limites) {
    if (valor >= limites.PREDICTIVE_4) return 'PREDICTIVE_4';
    if (valor >= limites.PREDICTIVE_3) return 'PREDICTIVE_3';
    if (valor >= limites.PREDICTIVE_2) return 'PREDICTIVE_2';
    if (valor >= limites.PREDICTIVE_1) return 'PREDICTIVE_1';
    return 'TOLERAVEL';
  }

  _votarProjecao(projecao30s, limites) {
    if (projecao30s >= limites.PREDICTIVE_4) return 'PREDICTIVE_4';
    if (projecao30s >= limites.PREDICTIVE_3) return 'PREDICTIVE_3';
    if (projecao30s >= limites.PREDICTIVE_2) return 'PREDICTIVE_2';
    if (projecao30s >= limites.PREDICTIVE_1) return 'PREDICTIVE_1';
    return 'TOLERAVEL';
  }

  _resolverNivel(votos, deltaTicket) {
    const hierarquia = { 'TOLERAVEL': 0, 'PREDICTIVE_1': 1, 'PREDICTIVE_2': 2, 'PREDICTIVE_3': 3, 'PREDICTIVE_4': 4 };

    // Conta votos por nível
    const contagem = { TOLERAVEL: 0, PREDICTIVE_1: 0, PREDICTIVE_2: 0, PREDICTIVE_3: 0, PREDICTIVE_4: 0 };
    contagem[votos.taxa]         = (contagem[votos.taxa] ?? 0) + 1;
    contagem[votos.delta_janela] = (contagem[votos.delta_janela] ?? 0) + 1;
    contagem[votos.projecao]     = (contagem[votos.projecao] ?? 0) + 1;

    // Nível base: mínimo 2 votos concordando no mesmo nível ou acima
    let nivelBase = 'TOLERAVEL';
    for (const [nivel, count] of Object.entries(contagem)) {
      if (count >= 2 && hierarquia[nivel] > hierarquia[nivelBase]) {
        nivelBase = nivel;
      }
    }

    // Double check pelo delta_ticket — pode escalar ou bloquear descida
    if (deltaTicket.estado === 'CRITICO' && hierarquia[nivelBase] < hierarquia['PREDICTIVE_4']) {
      return 'PREDICTIVE_4'; // Ticket piorando muito — escala direto
    }
    if (deltaTicket.estado === 'PIORANDO' && hierarquia[nivelBase] < 2) {
      return 'PREDICTIVE_2'; // Contenção não funcionou — sobe pelo menos um nível
    }
    if (deltaTicket.estado === 'SAUDAVEL' && hierarquia[nivelBase] > 0) {
      // Contenção funcionando — não escala além do atual
      const nivelAnterior = Object.keys(hierarquia).find(k => hierarquia[k] === hierarquia[nivelBase] - 1);
      return nivelAnterior ?? nivelBase;
    }

    return nivelBase;
  }

  _montarMotivos(votos, deltaJanela, eta, deltaTicket) {
    const motivos = [];
    if (votos.taxa         !== 'TOLERAVEL') motivos.push(`taxa: ${deltaJanela.taxaPorMinuto}°C/min → ${votos.taxa}`);
    if (votos.delta_janela !== 'TOLERAVEL') motivos.push(`delta: ${deltaJanela.delta}°C → ${votos.delta_janela}`);
    if (votos.projecao     !== 'TOLERAVEL') motivos.push(`projecao_30s: ${eta.projecoes.em30s}°C → ${votos.projecao}`);
    if (deltaTicket.estado && deltaTicket.estado !== 'SEM_TICKET' && deltaTicket.estado !== 'SAUDAVEL') {
      motivos.push(`delta_ticket: ${deltaTicket.delta}°C desde abertura → ${deltaTicket.estado}`);
    }
    return motivos;
  }
}

module.exports = new Classificador();