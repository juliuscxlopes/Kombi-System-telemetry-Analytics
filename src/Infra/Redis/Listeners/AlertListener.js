// src/Infrastructure/redis/listeners/AlertListener.js
const redisConfig = require('../Config/RedisConfig');
const sensorRouterController = require('../../../Controllers/SensorRouterController');
const logger = require('../../../log/logger');

class AlertListener {
  constructor() {
    this.sub = redisConfig.subClient;
    this.channel = redisConfig.CHANNELS.ALERTS;
    this.isRunning = false;
  }

  start() {
    this.isRunning = true;
    this._connect();
  }

  _connect() {
    if (!this.isRunning) return;

    logger.info(`🎧 [ALERT_LISTENER] Ouvindo canal ${this.channel} no Redis...`);

    // Inscreve no canal
    this.sub.subscribe(this.channel, (err) => {
      if (err) {
        logger.error(`❌ [ALERT_LISTENER] Erro ao subscrever: ${err.message}`);
      }
    });

    // Ouve as mensagens
    this.sub.on('message', async (chan, raw) => {
      if (chan !== this.channel) return;

      try {
        const payload = JSON.parse(raw);
        
        // Estrutura esperada: { sensor: 'OIL_TEMP', data: { value, status, ... } }
        const { sensor, data } = payload;

        // Roteia para o seu controller (mesma lógica do WS)
        await sensorRouterController.rotear(sensor, data.value, data);

      } catch (err) {
        logger.error(`❌ [ALERT_LISTENER] Erro ao processar mensagem: ${err.message}`);
      }
    });

    // Tratamento de erros e reconexão (o ioredis já faz muito disso internamente)
    this.sub.on('error', (err) => {
      logger.error(`❌ [ALERT_LISTENER] Erro no Redis: ${err.message}`);
    });
  }

  stop() {
    this.isRunning = false;
    this.sub.unsubscribe(this.channel);
    logger.info('🛑 [ALERT_LISTENER] Listener encerrado.');
  }
}

module.exports = new AlertListener();