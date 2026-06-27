// src/models/DAMAGE/THERMAL/ThermalDamageModule.js
const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const wsEmitter = require('../../../Infra/websocket/WsEmitter');
const publisherService = require('../../../Infra/Redis/Publisher/PublisherService');
const crossSpec = require('./ThermalDamageSpecs.json');
const logger = require('../../../log/logger');

const STREAM_HEALTH = 'stream:health';

class ThermalDamageModule {
  constructor() {
    this.NAME = 'THERMAL_DAMAGE_MODULE';
    this.rules = crossSpec.cross_thermal_rules;
  }

  async avaliar(estadoOil, estadoCHT) {
    try {
      // ── BUSCA ESTADO COMPLETO DO ENGINE ───────────────────────
      const engineState = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE) || {};
      const currentValues  = {};
      const currentStatuses = {};

      for (const [key, val] of Object.entries(engineState)) {
        try {
          const parsed = JSON.parse(val);
          currentValues[key]   = parsed.value  !== undefined ? parsed.value  : 0;
          currentStatuses[key] = parsed.status !== undefined ? parsed.status : 'OPERACIONAL';
        } catch {
          currentValues[key] = Number(val) || 0;
        }
      }

      const etaOil = estadoOil?.diagnostico?.janelas?.['1m']?.etaParaLimites?.criticoMinutos ?? 999;
      const etaCHT = estadoCHT?.diagnostico?.janelas?.['1m']?.etaParaLimites?.criticoMinutos ?? 999;
      const piorETA = Math.min(etaOil, etaCHT);

      // ── AVALIA TODAS AS REGRAS ────────────────────────────────
      const regrasAtivas = [];

      for (const rule of this.rules) {

        // 1. VERIFICA GATILHO
        const gatilhoAtivo = Object.entries(rule.gatilho).every(([sensor, statusExigido]) => {
          return this._statusMaisGrave(currentStatuses[sensor], statusExigido);
        });

        if (!gatilhoAtivo) continue;

        // 2. CALCULA AGRAVANTES
        let pesoTotal = 0;
        const agravantesAtivos = [];

        for (const agravante of rule.agravantes) {
          const valor = currentValues[agravante.sensor] || 0;
          if (this._comparar(valor, agravante.operator, agravante.value)) {
            pesoTotal += agravante.peso;
            agravantesAtivos.push({ sensor: agravante.sensor, valor });
          }
        }

        // 3. DECIDE NÍVEL
        let nivel = null;
        if (pesoTotal >= rule.peso_para_escalar) {
          nivel = 'PREDICTIVE_2';
        } else if (piorETA <= rule.PREDICTIVE_2.eta_minutos) {
          nivel = 'PREDICTIVE_2';
        } else if (piorETA <= rule.PREDICTIVE_1.eta_minutos) {
          nivel = 'PREDICTIVE_1';
        }

        const spec = nivel ? rule[nivel] : null;

        regrasAtivas.push({
          ruleId:          rule.id,
          grau:            rule.grau,
          nivel:           nivel ?? 'MONITORANDO',
          tag:             spec?.tag ?? 'PRE_DAMAGE_WARNING',
          description:     spec?.description ?? rule.description,
          actuators:       spec?.actuators ?? [],
          intensity:       spec?.intensity ?? '0%',
          agravantesAtivos,
          pesoTotal
        });

        logger.warn(`🌡️  [${this.NAME}] Regra ativa: ${rule.id} | Nível: ${nivel ?? 'MONITORANDO'} | Peso: ${pesoTotal}`);
      }

      // ── SNAPSHOT DO ENGINE ────────────────────────────────────
      const engineSnapshot = {
        OIL_TEMP:     { valor: currentValues['OIL_TEMP'],     status: currentStatuses['OIL_TEMP'],     etaCriticoMinutos: etaOil },
        CHT:          { valor: currentValues['CHT'],          status: currentStatuses['CHT'],          etaCriticoMinutos: etaCHT },
        OIL_PRESSURE: { valor: currentValues['OIL_PRESSURE'], status: currentStatuses['OIL_PRESSURE'] },
        LAMBDA:       { valor: currentValues['LAMBDA'],       status: currentStatuses['LAMBDA'] },
        VACUUM:       { valor: currentValues['VACUUM'],       status: currentStatuses['VACUUM'] },
        RPM:          { valor: currentValues['RPM'] }
      };

      // ── SEM REGRAS ATIVAS → OPERACIONAL ──────────────────────
      if (regrasAtivas.length === 0) {
        const payloadOperacional = {
          origem: this.NAME,
          status: 'OPERACIONAL',
          regrasAtivas: [],
          engineSnapshot,
          timestamp: Date.now()
        };

        await publisherService.health(STREAM_HEALTH, payloadOperacional, {});
        logger.info(`✅ [${this.NAME}] Sistema operacional — nenhuma regra de dano ativa.`);
        return;
      }

      // ── DISPARA CADA REGRA ATIVA INDIVIDUALMENTE ─────────────
      for (const regra of regrasAtivas) {
        if (regra.nivel === 'MONITORANDO') continue; // Só dispara WS quando tem nível definido

        const payloadWs = {
          origem:          this.NAME,
          ruleId:          regra.ruleId,
          grau:            regra.grau,
          nivel:           regra.nivel,
          tag:             regra.tag,
          description:     regra.description,
          actuators:       regra.actuators,
          intensity:       regra.intensity,
          agravantesAtivos: regra.agravantesAtivos,
          pesoTotal:       regra.pesoTotal,
          piorETA:         parseFloat(piorETA.toFixed(2)),
          engineSnapshot,
          timestamp:       Date.now()
        };

        wsEmitter.broadcast(regra.tag, payloadWs);
        logger.warn(`🚨 [${this.NAME}] ${regra.tag} | Regra: ${regra.ruleId} | Grau: ${regra.grau} | Peso: ${regra.pesoTotal}`);
      }

      // ── PUBLICA ESTADO COMPLETO NA STREAM:HEALTH ─────────────
      const payloadHealth = {
        origem:       this.NAME,
        status:       'ANOMALIA',
        totalRegras:  regrasAtivas.length,
        regrasAtivas,
        piorETA:      parseFloat(piorETA.toFixed(2)),
        engineSnapshot,
        timestamp:    Date.now()
      };

      await publisherService.health(STREAM_HEALTH, payloadHealth, {});
      logger.warn(`📡 [${this.NAME}] stream:health publicado | ${regrasAtivas.length} regra(s) ativa(s)`);

    } catch (err) {
      logger.error(`❌ [${this.NAME}] Falha na avaliação cruzada: ${err.message}`);
    }
  }

  _statusMaisGrave(statusAtual, statusExigido) {
    const hierarquia = { 'FRIO': 0, 'OPERACIONAL': 0, 'ALERTA': 1, 'CRITICO': 2 };
    return (hierarquia[statusAtual] ?? 0) >= (hierarquia[statusExigido] ?? 0);
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