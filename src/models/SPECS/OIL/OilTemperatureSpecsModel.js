// src/models/SPECS/OIL/OilTemperatureSpecsModel.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const oilSpecs = require('./oil_specs.json');
const publisherService = require('../../../Infra/Redis/Publisher/PublisherService');

const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b
};

class OilTemperatureSpecsModel {
  constructor() {
    this.NAME = 'OIL_TEMP_SPECS';
    this.specs = oilSpecs;
  }

  /**
   * MÉTODO PRINCIPAL: Avalia as regras v2 baseado nas métricas injetadas
   */
  async processar(sensorName, metrics) {
    try {
      // 1. FRESH CHECK STATE: Busca o estado atual na Hash do Redis
      const state = await redisConfig.client.hgetall('kombi:engine:state') || {};

      const currentVal = metrics.value;
      const taxaSegundo = metrics.taxaSubidaPorMinuto / 60;
      const stack = [];

      // Mapeamento local limpo para checagem rápida de condições
      const currentValues = {
        OIL_TEMP: currentVal,
        CHT: state.CHT ? JSON.parse(state.CHT).value : 0,
        RPM: state.RPM ? JSON.parse(state.RPM).value : 0,
        OIL_PRESSURE: state.OIL_PRESSURE ? JSON.parse(state.OIL_PRESSURE).value : 0,
        KNOCK: state.KNOCK ? JSON.parse(state.KNOCK).value : 0
      };

      // 2. GERENCIAMENTO DE RISCO ESTÁTICO (Identifica a faixa física atual do óleo)
      let currentRange = 'OPERACIONAL';
      const ranges = this.specs.thresholds.OIL_TEMP.ranges;
      if (currentVal >= ranges.CRITICO.min) currentRange = 'CRITICO';
      else if (currentVal >= ranges.ALERTA.min) currentRange = 'ALERTA';
      else if (currentVal < ranges.FRIO.max) currentRange = 'FRIO';

      // 3. AVALIAÇÃO DE REGRAS DIRETAS
      for (const rule of this.specs.direct_rules) {
        let condicoesValidas = true;

        for (const cond of rule.conditions) {
          const valorAtualSensor = currentValues[cond.sensor] || 0;
          const op = OPERATORS[cond.operator];
          if (!op || !op(valorAtualSensor, cond.value)) {
            condicoesValidas = false;
            break;
          }
        }

        if (condicoesValidas) {
          stack.push({
            id: rule.id,
            grau: rule.grau,
            severity: rule.severity,
            type: 'DIRECT',
            contention: {
              plan: rule.contention.plan,
              value: rule.contention.base_value,
              solution: rule.contention.solution
            },
            description: rule.description
          });
        }
      }

      // 4. AVALIAÇÃO DE REGRAS PREDITIVAS
      if (taxaSegundo > 0) {
        for (const rule of this.specs.predictive_rules) {
          let piorEtaDaRegra = null;
          let condicoesValidas = true;

          for (const target of rule.target_conditions) {
            const valorAtualSensor = currentValues[target.sensor] || 0;
            
            if (valorAtualSensor >= target.value) {
              piorEtaDaRegra = 0;
              continue;
            }

            const etaSensor = (target.value - valorAtualSensor) / taxaSegundo;
            const maxEtaConfigurado = Math.max(...Object.values(rule.eta_steps).map(s => s.max_eta));
            
            if (etaSensor > 0 && etaSensor <= maxEtaConfigurado) {
              piorEtaDaRegra = piorEtaDaRegra === null ? etaSensor : Math.max(piorEtaDaRegra, etaSensor);
            } else {
              condicoesValidas = false;
              break;
            }
          }

          if (condicoesValidas && piorEtaDaRegra !== null) {
            let estagioIdentificado = null;
            let dadosEstagio = null;

            for (const [estagio, limites] of Object.entries(rule.eta_steps)) {
              if (piorEtaDaRegra >= limites.min_eta && piorEtaDaRegra <= limites.max_eta) {
                estagioIdentificado = estagio;
                dadosEstagio = limites;
                break;
              }
            }

            if (piorEtaDaRegra === 0) {
              estagioIdentificado = 'PREDICTIVE_2';
              dadosEstagio = rule.eta_steps.PREDICTIVE_2;
            }

            if (estagioIdentificado && dadosEstagio) {
              stack.push({
                id: rule.id,
                grau: rule.grau,
                severity: rule.severity,
                type: estagioIdentificado,
                eta_seconds: parseFloat(piorEtaDaRegra.toFixed(1)),
                contention: {
                  plan: dadosEstagio.plan,
                  value: dadosEstagio.value,
                  solution: rule.id === 'ERR_OVERHEAT_STRUCTURAL_PREDICTIVE' ? ["FAN_OIL", "FAN_CHT"] : ["FAN_OIL"]
                },
                description: `${rule.description} ETA: ${piorEtaDaRegra.toFixed(1)}s.`
              });
            }
          }
        }
      }

      // 5. FILTRAGEM DO DIAGNÓSTICO MAIS CRÍTICO
      if (stack.length > 0) {
        stack.sort((a, b) => b.grau - a.grau);
        return stack[0]; 
      }

      // Retorna objeto default se tudo estiver ok
      return {
        current_range: currentRange,
        active_rule: 'NONE',
        grau: 0,
        severity: 'OPERACIONAL',
        type: 'STABLE',
        contention: { plan: 'none', value: '0%', solution: [] },
        description: `Motor operando em regime estável na faixa ${currentRange}.`
      };

    } catch (err) {
      console.error(`❌ [${this.NAME}] Erro ao processar pipeline de especificações:`, err.message);
      throw err;
    }
  }
}

module.exports = new OilTemperatureSpecsModel();