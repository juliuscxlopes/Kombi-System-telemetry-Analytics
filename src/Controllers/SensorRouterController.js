const OILTSensor     = require('../models/SENSORS/THERMAL/OilTSensor');
const CHTSensor      = require('../models/SENSORS/THERMAL/CHTSensor');
const thermalDamage = require('../models/DAMAGE/THERMAL/ThermalDamageModule');
const logger        = require('../log/logger');

class SensorRouterController {
  async rotear(sensorName, value, rawGlobalState) {
    try {
      switch (sensorName) {
        // ── PIPELINE TÉRMICO (histórico + math + ticket) ────────
        case 'OIL_TEMP':
          await OILTSensor.processar(value, 'WS');
          break;

        case 'CHT':
          await CHTSensor.processar(value, 'WS');
          break;

        // ── ACIONAMENTOS DE CROSS ANALYSIS (direto do core) ──────
        case 'RPM':
        case 'VACC':
        case 'OIL_PRES':
        case 'LAMBDA':
          logger.info(`🔀 [SENSOR_ROUTER] ${sensorName} recebido — acionando cross analysis.`);
          break;

        default:
          logger.debug(`[SENSOR_ROUTER] Tag sem handler específico: ${sensorName}`);
          break;
      }

      // 🚀 CROSS ANALYSIS — roda sempre, buscando o snapshot atualizado de tudo no Redis
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