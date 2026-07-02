// src/models/HISTORY/HistoryCollector.js
const redisConfig = require('../../Infra/Redis/config/redisConfig');
const logger = require('../../log/logger');

class HistoryCollector {
  constructor() {
    this.streamLogKey = 'barramento:stream:log';
    this.janelas = {
      '30s': 30 * 1000,
    };
  }

  /**
   * Coleta e retorna histórico particionado por janela.
   * @param {String} sensorName
   * @returns {{ '30s': [] }}
   */
  async coletar(sensorName) {
    try {
      const agora = Date.now();
      const tempoAtrasMax = agora - this.janelas['30s'];

      const registrosStream = await redisConfig.client.xrange(
        this.streamLogKey,
        tempoAtrasMax,
        agora
      );

      if (!registrosStream || registrosStream.length === 0) {
        logger.warn(`⚠️ [HISTORY_COLLECTOR] Nenhum dado encontrado para ${sensorName}`);
        return { '30s': []};
      }

      const allPoints = this._parseRegistros(registrosStream, sensorName);
      logger.debug(`📚 [HISTORY_COLLECTOR] ${sensorName} | Total de pontos: ${allPoints.length}`);

      // Particiona por janela e retorna
      const historicos = {};
      for (const [nomeJanela, ms] of Object.entries(this.janelas)) {
        const limiteTempo = agora - ms;
        historicos[nomeJanela] = allPoints.filter(p => p.ts >= limiteTempo);
      }

      return historicos;

    } catch (err) {
      logger.error(`❌ [HISTORY_COLLECTOR] Erro ao coletar histórico de ${sensorName}: ${err.message}`);
      return { '30s': []};
    }
  }

  _parseRegistros(registrosStream, sensorName) {
    const points = [];
    for (const [messageId, fields] of registrosStream) {
      const sensorIdx = fields.indexOf('sensor');
      const dataIdx   = fields.indexOf('data');

      if (sensorIdx !== -1 && dataIdx !== -1) {
        if (fields[sensorIdx + 1] === sensorName) {
          try {
            const payload = JSON.parse(fields[dataIdx + 1]);
            const ts = payload.ts || parseInt(messageId.split('-')[0], 10);
            points.push({ value: payload.value, ts: parseInt(ts, 10) });
          } catch (e) {
            // silencioso
          }
        }
      }
    }
    return points;
  }
}

module.exports = new HistoryCollector();