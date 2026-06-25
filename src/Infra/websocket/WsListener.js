// src/Infra/Ws/WsListener.js
const WebSocket = require('ws');
const sensorRouterController = require('../../Controllers/SensorRouterController');
const logger = require('../../utils/log/logger');

const WS_CORE_URL = process.env.WS_CORE_URL || 'ws://telemetry-core:3000';

class WsListener {
  constructor() {
    this.ws = null;
    this.reconnectDelayMs = 3000;
    this.isRunning = false;
  }

  start() {
    this.isRunning = true;
    this._connect();
  }

  _connect() {
    if (!this.isRunning) return;

    logger.info(`📡 [WS_LISTENER] Conectando ao core em ${WS_CORE_URL}...`);
    this.ws = new WebSocket(WS_CORE_URL);

    this.ws.on('open', () => {
      logger.info('✅ [WS_LISTENER] Conexão estabelecida com kombi-core.');
    });

    this.ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw);

        // { OIL_TEMP: { value, status, isHardwareOk, ts } }
        const sensorName = Object.keys(data)[0];
        const payload = data[sensorName];

        logger.info(`🚨 [WS_LISTENER] Alerta recebido | Sensor: ${sensorName} | Status: ${payload.status}`);

        await sensorRouterController.rotear(sensorName, payload.value, payload);

      } catch (err) {
        logger.error(`❌ [WS_LISTENER] Erro ao processar mensagem: ${err.message}`);
      }
    });

    this.ws.on('close', () => {
      logger.warn(`⚠️  [WS_LISTENER] Conexão encerrada. Reconectando em ${this.reconnectDelayMs}ms...`);
      setTimeout(() => this._connect(), this.reconnectDelayMs);
    });

    this.ws.on('error', (err) => {
      logger.error(`❌ [WS_LISTENER] Erro de socket: ${err.message}`);
      // O 'close' já dispara o reconnect, não precisa tratar aqui
    });
  }

  stop() {
    this.isRunning = false;
    this.ws?.close();
    logger.info('🛑 [WS_LISTENER] Listener encerrado.');
  }
}

module.exports = new WsListener();