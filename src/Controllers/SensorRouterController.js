// src/controllers/SensorRouterController.js
const controllerOilT = require('./OILTController/ControllerOilT');

class SensorRouterController {
  /**
   * Roteia a leitura bruta vinda do Worker para o controlador específico
   */
  async rotear(sensorName, value, rawGlobalState) {
    try {
      switch (sensorName) {
        case 'OIL_TEMP':
          // Passa o valor e o snapshot do estado global para o controlador com Lock
          await controllerOilT.processar(value, rawGlobalState);
          break;

        // Seus ganchos para os próximos sensores entram aqui de forma limpa:
        // case 'CHT':
        //   await controllerCHT.processar(value, rawGlobalState);
        //   break;

        default:
          // Ignora ou loga sensores que não possuem pipeline analítico ativo no Analytics
          break;
      }
    } catch (err) {
      console.error(`❌ [SENSOR_ROUTER] Erro ao rotear sensor [${sensorName}]:`, err.message);
    }
  }
}

module.exports = new SensorRouterController();