// src/controllers/SensorRouterController.js
const OILTSensor    = require('../models/SENSORS/THERMAL/OilTSensor');
const CHTSensor     = require('../models/SENSORS/THERMAL/CHTSensor');
const thermalDamage = require('../models/DAMAGE/THERMAL/ThermalDamageModule');
const logger        = require('../log/logger');

class SensorRouterController {
  async rotear(sensorName, value, rawGlobalState) {
    try {
      switch (sensorName) {

        // ── PIPELINE COMPLETO (histórico + math + ticket) ────────
        case 'OIL_TEMP':
          await OILTSensor.processar(value, 'WS');
          break;

        case 'CHT':
          await CHTSensor.processar(value, 'WS');
          break;

        // ── SÓ ACIONA CROSS ANALYSIS (sem pipeline próprio) ──────
        case 'OIL_PRESSURE':
        case 'LAMBDA':
          logger.info(`🔀 [SENSOR_ROUTER] ${sensorName} em alerta — acionando cross analysis.`);
          break;

        default:
          logger.debug(`[SENSOR_ROUTER] Tag sem handler: ${sensorName}`);
          break;
      }

      // CROSS ANALYSIS — roda sempre, independente do sensor
      await thermalDamage.avaliar(
        OILTSensor.getEstado(),
        CHTSensor.getEstado()
      );

    } catch (err) {
      logger.error(`❌ [SENSOR_ROUTER] Erro ao rotear [${sensorName}]: ${err.message}`);
    }
  }
}

module.exports = new SensorRouterController();