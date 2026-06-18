// src/models/ENGINE/OIL/OilTemperatureModel.js
const oilTemperatureCalcModel = require('../../../MATH/OIL/OilTemperatureCalcModel');
const oilTemperatureSpecsModel = require('../../../SPECS/OIL/OilTemperatureSpecsModel');
const PublisherService = require('../../../Infra/Redis/Publisher/PublisherService');

class OilTemperatureModel {
  constructor() {
    this.name = 'OIL_TEMP';
  }

  /**
   * Executa em cadeia o cálculo matemático e o processamento clínico de especificações
   */
  async analisar(initialValue, initialGlobalState) {
      try {
        // 1. Recebe as métricas calculadas em vez de deixar ele publicar sozinho
        const metrics = await oilTemperatureCalcModel.processar(this.name, initialValue, initialGlobalState);
        
        // 2. Passa o objeto de métricas diretamente para o Specs
        const diagnosis = await oilTemperatureSpecsModel.processar(this.name, metrics);
        
        // 3. Publica a versão final completa (Métricas + Diagnóstico validado)
        publisherService.health(this.name, metrics, diagnosis);

      } catch (err) {
        console.error(`❌ [${this.name}_MODEL] Erro fatal no pipeline:`, err.message);
        throw err;
      }
  }
}

module.exports = new OilTemperatureModel();