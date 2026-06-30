const redisConfig = require('../../../Infra/Redis/config/redisConfig');
const wsEmitter = require('../../../Infra/websocket/WsEmitter');
const publisherService = require('../../../Infra/Redis/Publisher/PublisherService');
const crossSpec = require('./ThermalDamageSpecs.json');
const logger = require('../../../log/logger');

const STREAM_ALERTS = 'stream:alerts';

class ThermalDamageModule {
  constructor() {
    this.NAME = 'THERMAL_DAMAGE_MODULE';
    this.rules = crossSpec.cross_thermal_rules;
  }

  async avaliar(estadoOil, estadoCHT) {
    try {
      // ── BUSCA ESTADO COMPLETO DO ENGINE ───────────────────────
      const engineState = await redisConfig.client.hgetall(redisConfig.HASHES.ENGINE_STATE) || {};
      const currentValues   = {};
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

      const etaOil = estadoOil?.diagnostico?.janelas?.['30s']?.etaParaLimites?.criticoMinutos ?? 999;
      const etaCHT = estadoCHT?.diagnostico?.janelas?.['30s']?.etaParaLimites?.criticoMinutos ?? 999;
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

        if (!nivel) continue;

        const spec = rule[nivel];

        regrasAtivas.push({
          ruleId:          rule.id,
          grau:            rule.grau,
          nivel:           nivel,
          tag:             spec?.tag ?? 'PRE_DAMAGE_WARNING',
          description:     spec?.description ?? rule.description,
          actuators:       spec?.actuators ?? [],
          intensity:       spec?.intensity ?? '0%',
          agravantesAtivos,
          pesoTotal
        });

        logger.warn(`🌡️  [${this.NAME}] Regra cruzada ativa: ${rule.id} | Nível: ${nivel} | Peso: ${pesoTotal}`);
      }

      const engineSnapshot = {
        OIL_TEMP:     { valor: currentValues['OIL_TEMP'],     status: currentStatuses['OIL_TEMP'],     etaCriticoMinutos: etaOil },
        CHT:          { valor: currentValues['CHT'],          status: currentStatuses['CHT'],          etaCriticoMinutos: etaCHT },
        OIL_PRESSURE: { valor: currentValues['OIL_PRESSURE'], status: currentStatuses['OIL_PRESSURE'] },
        LAMBDA:       { valor: currentValues['LAMBDA'],       status: currentStatuses['LAMBDA'] },
        VACUUM:       { valor: currentValues['VACUUM'],       status: currentStatuses['VACUUM'] },
        RPM:          { valor: currentValues['RPM'] }
      };

      if (regrasAtivas.length === 0) {
        logger.info(`✅ [${this.NAME}] Sistema operacional — nenhuma regra de dano cruzado ativa.`);
        return;
      }

      // ── DISPARA CADA REGRA ATIVA INDIVIDUALMENTE ─────────────
// ── DISPARA CADA REGRA ATIVA INDIVIDUALMENTE ─────────────
for (const regra of regrasAtivas) {
  if (regra.nivel === 'MONITORANDO') continue;

  // 1. BROADCAST PARA O FRONT-END (Alerta de Dano)
    const payloadWs = {
      origem:          this.NAME,
      ruleId:          regra.ruleId,
      grau:            regra.grau,
      nivel:           regra.nivel,
      tag:             regra.tag,
      description:     regra.description,
      agravantesAtivos: regra.agravantesAtivos,
      pesoTotal:       regra.pesoTotal,
      piorETA:         parseFloat(piorETA.toFixed(2)),
      engineSnapshot,
      timestamp:       Date.now()
    };
    wsEmitter.broadcast(regra.tag, payloadWs);

    // 2. BROADCAST DE ATUAÇÃO PARA O CORE (String simples: FAN_OIL:100)
    // O Core já está esperando a tag do atuador e a intensidade pura
    const intensidadePura = regra.intensity.replace('%', '');
    
    if (regra.actuators && regra.actuators.length > 0) {
      for (const atuadorTag of regra.actuators) {
        // Broadcast direto na rede com o comando puro (ex: FAN_OIL, 100)
        wsEmitter.broadcast(atuadorTag, intensidadePura);
        logger.info(`🛫 [${this.NAME}] Comando direto via WS | ${atuadorTag}: ${intensidadePura}`);
      }
    }

    // 3. PERSISTÊNCIA NA HSET ALERTS
    const sensorTicketAfetado = regra.ruleId.includes('CHT') ? 'CHT' : 'OIL_TEMP';
    const payloadAlerta = {
      ticket: `TICKET_${sensorTicketAfetado}_${Date.now()}`,
      sensor: sensorTicketAfetado,
      lifecycle: 'ATUALIZADO',
      predictive: {
        tipo: regra.nivel,
        intensity: regra.intensity,
        description: regra.description
      },
      timestamp: Date.now()
    };

    // Persiste no HSET de Alertas
    await redisConfig.client.hset(
      'HSET:ALERTS', 
      sensorTicketAfetado, 
      JSON.stringify(payloadAlerta)
    );
    
    logger.warn(`🎫 [${this.NAME}] Ticket ${sensorTicketAfetado} persistido em HSET:ALERTS`);
  }

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