// src/models/HISTORY/HistoryCollector.js
const redisConfig = require('../../Infra/Redis/config/redisConfig');
const publisherService = require('../../Infra/Redis/Publisher/PublisherService');

class HistoryCollector {
  constructor() {
    this.streamLogKey = 'barramento:stream:log'; 
    // Janelas em milissegundos
    this.janelas = {
      '30s': 30 * 1000,
      '1m': 60 * 1000,
      '3m': 180 * 1000,
      '5m': 300 * 1000
    };
  }

  async processarEExportarHistorico(ticket, sensorName) {
    try {
      const agora = Date.now();
      // Pega a maior janela para cobrir todas as análises (5 minutos)
      const tempoAtrasMax = agora - this.janelas['5m'];

      // Busca os registros da janela máxima na stream central
      const registrosStream = await redisConfig.client.xrange(this.streamLogKey, tempoAtrasMax, agora);

      if (!registrosStream || registrosStream.length === 0) {
        console.warn(`⚠️ [HISTORY_COLLECTOR] Nenhum dado encontrado para o sensor ${sensorName}`);
        return;
      }

      // Converte os dados brutos da stream para o formato de pontos
      const allPoints = this._parseRegistros(registrosStream, sensorName);

      // Filtra e publica o histórico para cada janela solicitada
      for (const [nomeJanela, ms] of Object.entries(this.janelas)) {
        const limiteTempo = agora - ms;
        const pointsWindow = allPoints.filter(p => p.ts >= limiteTempo);

        const payloadStream = {
          ticket,
          sensor: sensorName,
          window: nomeJanela,
          timestamp: agora,
          data: pointsWindow
        };

        // Publica na stream específica de histórico/métricas // AQUI PRECISAMOS DE PUBLICAR NA STREAM HESTORY
        publisherService.health(`stream:history:${nomeJanela.toLowerCase()}`, payloadStream, {});//ajuste strem propria
      }

      console.info(`📊 [HISTORY_COLLECTOR] Histórico particionado e publicado para o Ticket: ${ticket}`);
      
    } catch (err) {
      console.error(`❌ [HISTORY_COLLECTOR] Erro ao coletar e exportar histórico:`, err.message);
    }
  }

  _parseRegistros(registrosStream, sensorName) {
    const points = [];
    for (const [messageId, fields] of registrosStream) {
      const sensorIdx = fields.indexOf('sensor');
      const dataIdx = fields.indexOf('data');

      if (sensorIdx !== -1 && dataIdx !== -1) {
        const sName = fields[sensorIdx + 1];
        
        if (sName === sensorName) {
          try {
            const payload = JSON.parse(fields[dataIdx + 1]);
            const ts = payload.ts || parseInt(messageId.split('-')[0], 10);
            
            points.push({
              value: payload.value,
              ts: parseInt(ts, 10)
            });
          } catch (e) {
            // Silencioso ou log individual para não quebrar o loop
          }
        }
      }
    }
    return points;
  }
}

module.exports = new HistoryCollector();