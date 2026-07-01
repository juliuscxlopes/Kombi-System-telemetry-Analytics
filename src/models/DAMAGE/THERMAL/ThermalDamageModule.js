const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const wsEmitter   = require('../../../Infra/websocket/WsEmitter');
const crossSpec   = require('./ThermalDamageSpecs.json');
const logger      = require('../../../log/logger');

class ThermalDamageModule {
  constructor() {
    this.NAME  = 'THERMAL_DAMAGE_MODULE';
    this.rules = crossSpec.cross_thermal_rules;
  }

  async avaliar(estadoOil, estadoCHT) {
    try {

      // ── SNAPSHOT DO ENGINE STATE ──────────────────────────────
      const engineState     = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE) || {};
      const currentValues   = {};
      const currentStatuses = {};

      for (const [key, val] of Object.entries(engineState)) {
        try {
          const parsed         = JSON.parse(val);
          currentValues[key]   = parsed.value  !== undefined ? parsed.value  : 0;
          currentStatuses[key] = parsed.status !== undefined ? parsed.status : 'OPERACIONAL';
        } catch {
          currentValues[key] = Number(val) || 0;
        }
      }

      // ── ETA ───────────────────────────────────────────────────
      const etaOil  = estadoOil?.diagnostico?.janelas?.['30s']?.etaCriticoMinutos ?? 999;
      const etaCHT  = estadoCHT?.diagnostico?.janelas?.['30s']?.etaCriticoMinutos ?? 999;
      const piorETA = Math.min(etaOil, etaCHT);

      const engineSnapshot = {
        OIL_TEMP:     { valor: currentValues['OIL_TEMP'],     status: currentStatuses['OIL_TEMP'],     etaCriticoMinutos: etaOil },
        CHT:          { valor: currentValues['CHT'],          status: currentStatuses['CHT'],          etaCriticoMinutos: etaCHT },
        OIL_PRESSURE: { valor: currentValues['OIL_PRESSURE'], status: currentStatuses['OIL_PRESSURE'] },
        LAMBDA:       { valor: currentValues['LAMBDA'],       status: currentStatuses['LAMBDA'] },
        VACUUM:       { valor: currentValues['VACUUM'],       status: currentStatuses['VACUUM'] },
        RPM:          { valor: currentValues['RPM'] }
      };

      // ── AVALIA TODAS AS REGRAS ────────────────────────────────
      const regrasAtivas = [];

      for (const rule of this.rules) {

        // 1. GATILHO
        const gatilhoAtivo = Object.entries(rule.gatilho).every(([sensor, statusExigido]) =>
          this._statusMaisGrave(currentStatuses[sensor], statusExigido)
        );
        if (!gatilhoAtivo) continue;

        // 2. AGRAVANTES
        let pesoTotal          = 0;
        const agravantesAtivos = [];

        for (const agravante of rule.agravantes) {
          const valor = currentValues[agravante.sensor] ?? 0;
          if (this._comparar(valor, agravante.operator, agravante.value)) {
            pesoTotal += agravante.peso;
            agravantesAtivos.push({ sensor: agravante.sensor, valor });
          }
        }

        // 3. NÍVEL
        let nivel = null;
        if (pesoTotal >= rule.peso_para_escalar) {
          nivel = 'PREDICTIVE_2';
        } else if (piorETA <= rule.PREDICTIVE_2.eta_minutos && rule.PREDICTIVE_2.eta_minutos > 0) {
          nivel = 'PREDICTIVE_2';
        } else if (piorETA <= rule.PREDICTIVE_1.eta_minutos) {
          nivel = 'PREDICTIVE_1';
        }

        if (!nivel) continue;

        const spec = rule[nivel];

        regrasAtivas.push({
          ruleId:           rule.id,
          grau:             rule.grau,
          nivel,
          tag:              spec.tag,
          description:      spec.description,
          actuators:        spec.actuators ?? [],
          intensity:        spec.intensity ?? '0%',
          agravantesAtivos,
          pesoTotal
        });

        logger.warn(`🌡️  [${this.NAME}] Regra ativa: ${rule.id} | Grau: ${rule.grau} | Nível: ${nivel} | Peso: ${pesoTotal} | piorETA: ${piorETA.toFixed(2)}min`);
      }

      // ── SEM REGRAS ATIVAS ─────────────────────────────────────
      if (regrasAtivas.length === 0) {
        await this._resolverInativas([]);
        logger.info(`✅ [${this.NAME}] Sistema operacional — nenhuma regra de dano cruzado ativa.`);
        return;
      }

      // ── DISPARA REGRAS ATIVAS ─────────────────────────────────
      for (const regra of regrasAtivas) {

        const intensidade = regra.intensity.replace('%', ''); // ex: "100"

        // Payload único — core consome `intensity`, frontend consome tudo
        const payload = {
          intensity:        intensidade,   // ← core lê isso, ignora o resto
          source:           this.NAME,
          ruleId:           regra.ruleId,
          grau:             regra.grau,
          nivel:            regra.nivel,
          tag:              regra.tag,
          description:      regra.description,
          agravantesAtivos: regra.agravantesAtivos,
          pesoTotal:        regra.pesoTotal,
          piorETA:          parseFloat(piorETA.toFixed(2)),
          engineSnapshot,
          timestamp:        Date.now()
        };

        if (regra.actuators.length > 0) {
          // Com atuador — tag é o atuador, core intercepta e atua
          for (const atuadorTag of regra.actuators) {
            wsEmitter.broadcast(atuadorTag, payload);
            logger.info(`🛫 [${this.NAME}] Broadcast | ${atuadorTag}: ${intensidade} (${regra.ruleId})`);
          }
        } else {
          // Sem atuador — tag é o tipo do alerta, só frontend recebe
          wsEmitter.broadcast(regra.tag, payload);
          logger.info(`📢 [${this.NAME}] Broadcast aviso | ${regra.tag} (${regra.ruleId})`);
        }

        // ── PERSISTÊNCIA NA HASH PRÓPRIA ─────────────────────
        await redisConfig.client.hset(
          redisConfig.HASHES.DAMAGE_ALERTS,
          regra.ruleId,
          JSON.stringify({ ...payload, lifecycle: 'ATIVO' })
        );

        logger.warn(`🎫 [${this.NAME}] Damage alert persistido | ${regra.ruleId} → ${regra.nivel}`);
      }

      // ── RESOLVE REGRAS QUE NÃO DISPARARAM MAIS ───────────────
      await this._resolverInativas(regrasAtivas.map(r => r.ruleId));

    } catch (err) {
      logger.error(`❌ [${this.NAME}] Falha na avaliação cruzada: ${err.message}`);
    }
  }

  /**
   * Marca como RESOLVIDO qualquer regra ATIVA que não disparou nesse ciclo
   */
  async _resolverInativas(ruleIdsAtivos) {
    try {
      const raw = await redisConfig.client.hgetall(redisConfig.HASHES.DAMAGE_ALERTS);
      if (!raw) return;

      for (const [ruleId, val] of Object.entries(raw)) {
        const damage = JSON.parse(val);
        if (damage.lifecycle === 'ATIVO' && !ruleIdsAtivos.includes(ruleId)) {
          damage.lifecycle   = 'RESOLVIDO';
          damage.resolvidoTs = Date.now();
          await redisConfig.client.hset(
            redisConfig.HASHES.DAMAGE_ALERTS,
            ruleId,
            JSON.stringify(damage)
          );
          logger.info(`✅ [${this.NAME}] Regra resolvida: ${ruleId}`);
        }
      }
    } catch (err) {
      logger.error(`❌ [${this.NAME}] Falha ao resolver regras inativas: ${err.message}`);
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