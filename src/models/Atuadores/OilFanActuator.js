// src/models/ACTUATOR/FanOilActuatorModel.js
const redisConfig = require('../../Infra/Redis/config/redisConfig');

class FanOilActuatorModel {
  constructor() {
    this.NAME = 'FAN_OIL';
  }

  /**
   * Solicita a ativação gravando direto na stream de log geral do ecossistema.
   */
  async demandar(nomePlano, valorSugerido, sensorOrigem, regraOrigem) {
    try {
      const statusSolicitado = valorSugerido === '0%' ? 'OFF' : 'activating';

      // Payload único estruturado que entra na linha do tempo global da Kombi
      const payload = {
        atuador: this.NAME,
        status: statusSolicitado, // "activating" ou "OFF"
        value: valorSugerido,     // Rotação PWM (ex: "50%")
        plan: nomePlano,
        sensor_gatilho: sensorOrigem,
        origem_regra: regraOrigem,
        evento: `Solicitando status [${statusSolicitado}] a ${valorSugerido} via plano [${nomePlano}].`,
        ts: Date.now().toString()
      };

      // Injeta direto na única stream de log central configurada
      await redisConfig.client.xadd(redisConfig.STREAMS.LOG, '*', 'payload', JSON.stringify(payload));

      console.log(`📥 [${this.NAME}] Intenção [${statusSolicitado}] gravada na stream log.`);

    } catch (err) {
      console.error(`❌ [${this.NAME}] Erro ao publicar no log geral:`, err.message);
      throw err;
    }
  }
}

module.exports = new FanOilActuatorModel();