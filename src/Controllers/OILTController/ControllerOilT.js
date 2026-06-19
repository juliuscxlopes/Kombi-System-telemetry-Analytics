// src/controllers/OILTController/ControllerOilT.js
const oilTemperatureModel = require('../../models/SENSORS/ENGINE/OIL/OilTemperatureModel');

class ControllerOilT {
  constructor() {
    this.isAnalyzing = false; // 🔒 O Lock vive aqui para evitar enchentes de leitura
    this.sensorName = 'OIL_TEMP';
  }

  async processar(value, rawGlobalState) {
    // Se o pipeline ainda estiver digerindo a leitura anterior, ignora a atual
    if (this.isAnalyzing) return;

    // Ativa a trava
    this.isAnalyzing = true;

    try {
      // Dispara o pipeline assíncrono do sensor de forma direta
      await oilTemperatureModel.analisar(value, rawGlobalState);

    } catch (err) {
      console.error(`❌ [CONTROLLER OILT] Erro ao disparar o pipeline:`, err.message);
    } finally {
      // 🔓 DESTRAVA: Permite que o próximo ciclo sensorial entre
      this.isAnalyzing = false;
    }
  }
}

module.exports = new ControllerOilT();