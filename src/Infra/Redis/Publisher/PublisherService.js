// src/Infra/Redis/Publisher/PublisherService.js
const redisConfig = require('../config/redisConfig');

class PublisherService {
  constructor() {
    // Centraliza o mapeamento exato das suas 3 streams principais
    this.STREAMS = {
      HEALTH: redis.STREAMS?.HEALTH || 'stream:health',
      ACTUATOR: redis.STREAMS?.ACTUATOR || 'stream:actuators',
      LOG: redis.STREAMS?.LOG || 'stream:logs:actuators'
    };
  }

  /**
   * 🏥 1. Canal de Saúde e Diagnóstico do Sensor (Foco em Telemetria e Spec)
   * @param {string} sensor - Nome do sensor (ex: 'OIL_TEMP')
   * @param {object} metrics - Objeto contendo os calculos/tendencias
   * @param {object} diagnosis - Veredito vindo da Spec
   */
  health(sensor, metrics, diagnosis) {
    const payload = {
      sensor,
      status: 'Analise',
      metrics,
      diagnosis,
      ts: Date.now().toString()
    };

    this._fireAndForget(this.STREAMS.HEALTH, payload);
  }

  /**
   * ⚡ 2. Canal de Comando Bruto de Hardware (Foco no Core físico)
   * @param {string} atuador - Nome do atuador (ex: 'FAN_OIL')
   * @param {string} status - Estado de transição ('Active', 'Starting', 'Ligado')
   * @param {string} value - Potência do PWM ou acionamento (ex: '25%')
   * @param {string} plan - Nome do plano ativo (ex: 'OILTdecreasePlan')
   */
  actuator(atuador, status, value, plan) {
    const payload = {
      atuador,
      status,
      value,
      plan,
      ts: Date.now().toString()
    };

    this._fireAndForget(this.STREAMS.ACTUATOR, payload);
  }

  /**
   * 📜 3. Canal de Linha do Tempo e Histórico Humano
   * @param {string} atuador - Nome do atuador dono do evento
   * @param {string} evento - Descrição legível do que aconteceu
   * @param {string} estagioAtual - Estágio de potência no momento
   * @param {string} plan - Plano associado
   */
  log(atuador, evento, estagioAtual, plan) {
    const payload = {
      atuador,
      evento,
      estagio_atual: estagioAtual,
      plan,
      ts: Date.now().toString()
    };

    this._fireAndForget(this.STREAMS.LOG, payload);
  }

  /**
   * 🚀 Método privado Fire-and-Forget usando XADD para não bloquear o Kernel
   */
  _fireAndForget(streamName, payload) {
    // Injeta na stream usando o ID auto-gerado '*' do Redis
    redis.xadd(streamName, '*', 'payload', JSON.stringify(payload))
      .catch(err => console.error(`❌ [PUBLISHER-SERVICE] Erro assíncrono na stream ${streamName}:`, err.message));
  }
}

module.exports = new PublisherService();