// src/models/THERMAL/ThermalDamageModule.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const wsEmitter = require('../../../Infra/websocket/WsEmitter');
const crossSpec = require('./ThermalDamageSpecs.json');
const logger = require('../../../log/logger');

class ThermalDamageModule {
  constructor() {
    this.NAME = 'THERMAL_DAMAGE_MODULE';
    this.rule = crossSpec.cross_thermal_rules[0]; // ERR_OVERHEAT_STRUCTURAL
  }

  /**
   * Recebe os estados já analisados dos dois controllers.
   * Só atua se ambos tiverem ticket ativo.
   */
  async avaliar(estadoOil, estadoCHT) {
    try {

      // ── GATILHO: ambos precisam ter ticket ativo ──────────────
      if (!estadoOil?.ticketAtivo || !estadoCHT?.ticketAtivo) return;

      logger.warn(`🌡️  [${this.NAME}] Gatilho ativado — OIL_TEMP + CHT em anomalia simultânea.`);

      // ── BUSCA AGRAVANTES NA STREAM ENGINE ─────────────────────
      const engineState = await redisConfig.client.hgetall('kombi:engine:state') || {};
      const currentValues = {};
      for (const [key, val] of Object.entries(engineState)) {
        try {
          const parsed = JSON.parse(val);
          currentValues[key] = parsed.value !== undefined ? parsed.value : parsed;
        } catch {
          currentValues[key] = Number(val) || 0;
        }
      }

      // ── CALCULA PESO DOS AGRAVANTES ───────────────────────────
      let pesoTotal = 0;
      const agravantesAtivos = [];

      for (const agravante of this.rule.agravantes) {
        const valorSensor = currentValues[agravante.sensor] || 0;
        const dispara = this._comparar(valorSensor, agravante.operator, agravante.value);

        if (dispara) {
          pesoTotal += agravante.peso;
          agravantesAtivos.push({ sensor: agravante.sensor, valor: valorSensor });
        }
      }

      // ── DECIDE O NÍVEL PREDITIVO ──────────────────────────────
      // Pior ETA entre os dois sensores define a urgência
      const etaOilMinutos  = estadoOil.diagnostico?.janelas?.['1m']?.etaParaLimites?.criticoMinutos || 999;
      const etaCHTMinutos  = estadoCHT.diagnostico?.janelas?.['1m']?.etaParaLimites?.criticoMinutos || 999;
      const piorETA = Math.min(etaOilMinutos, etaCHTMinutos);

      let nivel = null;

      // Agravante com peso >= limiar escala direto pra PREDICTIVE_2
      if (pesoTotal >= this.rule.peso_para_escalar) {
        nivel = 'PREDICTIVE_2';
      } else if (piorETA <= this.rule.PREDICTIVE_2.eta_minutos) {
        nivel = 'PREDICTIVE_2';
      } else if (piorETA <= this.rule.PREDICTIVE_1.eta_minutos) {
        nivel = 'PREDICTIVE_1';
      }

      if (!nivel) {
        logger.info(`[${this.NAME}] Gatilho ativo mas ETA ainda confortável (${piorETA.toFixed(1)} min). Monitorando.`);
        return;
      }

      // ── MONTA E DISPARA O BROADCAST ───────────────────────────
      const spec = this.rule[nivel];

      const payload = {
        ruleId: this.rule.id,
        nivel,
        tag: spec.tag,
        description: spec.description,
        sensors: {
          OIL_TEMP: { atual: estadoOil.diagnostico?.janelas?.['1m']?.atual, etaCriticoMinutos: etaOilMinutos },
          CHT:      { atual: estadoCHT.diagnostico?.janelas?.['1m']?.atual, etaCriticoMinutos: etaCHTMinutos }
        },
        agravantesAtivos,
        pesoTotal,
        piorETA: parseFloat(piorETA.toFixed(2)),
        actuators: spec.actuators,
        intensity: spec.intensity,
        timestamp: Date.now()
      };

      wsEmitter.broadcast(spec.tag, payload);
      logger.warn(`🚨 [${this.NAME}] ${spec.tag} disparado | ETA: ${piorETA.toFixed(1)}min | Peso agravantes: ${pesoTotal}`);

    } catch (err) {
      logger.error(`❌ [${this.NAME}] Falha na avaliação cruzada: ${err.message}`);
    }
  }

  _comparar(valor, operator, limite) {
    const ops = {
      '>':  (a, b) => a > b,
      '>=': (a, b) => a >= b,
      '<':  (a, b) => a < b,
      '<=': (a, b) => a <= b
    };
    return ops[operator]?.(valor, limite) ?? false;
  }
}

module.exports = new ThermalDamageModule();