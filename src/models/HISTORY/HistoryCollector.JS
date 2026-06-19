// src/models/HISTORY/HistoryCollector.JS
const redisConfig = require('../../../Infra/Redis/config/redisConfig');

class HistoryCollector {
  constructor() {
    this.HISTORY_WINDOW_MS = 60000; // 1 minuto
    this.streamLogKey = 'barramento:stream:log'; // Chave unificada do StreamRules
  }

  async coletar(sensorName) {
    const agora = Date.now();
    const umMinutoAtras = agora - this.HISTORY_WINDOW_MS;

    // Busca os registros do último minuto na stream de log central do barramento
    // O XRANGE no ioredis aceita '-' e '+' para limites ou milissegundos
    const registrosStream = await redisConfig.client.xrange(this.streamLogKey, umMinutoAtras, agora);

    if (!registrosStream || registrosStream.length === 0) {
      return [];
    }

    // Parse dos pontos históricos gravados pelo canhão (Core)
    const points = [];
    for (const [messageId, fields] of registrosStream) {
      // Campos armazenados: ['sensor', sensorName, 'data', dataString]
      const sensorIdx = fields.indexOf('sensor');
      const dataIdx = fields.indexOf('data');

      if (sensorIdx !== -1 && dataIdx !== -1) {
        const sName = fields[sensorIdx + 1];
        
        // Filtra para garantir que o dado pertence a este sensor específico
        if (sName === sensorName) {
          try {
            const payload = JSON.parse(fields[dataIdx + 1]);
            // O payload possui { value, ts } ou usamos o timestamp do ID do Redis
            const ts = payload.ts || parseInt(messageId.split('-')[0], 10);
            
            points.push({
              value: payload.value,
              ts: parseInt(ts, 10)
            });
          } catch (e) {
            // Ignora payload corrompido silenciosamente
          }
        }
      }
    }

    return points;
  }
}

module.exports = new HistoryCollector();