// src/controllers/SensorRouterController.js
const OILTSensor    = require('../models/SENSORS/THERMAL/OilTSensor');
const CHTSensor     = require('../models/SENSORS/THERMAL/CHTSensor');
const thermalDamage = require('../models/DAMAGE/THERMAL/ThermalDamageModule');
const logger        = require('../log/logger');

class SensorRouterController {
  async rotear(sensorName, value, rawGlobalState) {
    try {
      switch (sensorName) {
        case 'OIL_TEMP':
          await OILTSensor.processar(value, rawGlobalState);
          break;

        case 'CHT_TEMP':
          await CHTSensor.processar(value, rawGlobalState);
          break;

        default:
          break;
      }

      // CROSS ANALYSIS — sempre após qualquer sensor térmico processar
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