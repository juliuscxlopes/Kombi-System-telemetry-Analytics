// src/Infra/websocket/WsEmitter.js
const WebSocket = require('ws');
const logger = require('../../log/logger');

class WsEmitter {
  broadcast(tag, data) {
    if (!global.wsConfig?.wss) {
      logger.warn(`[WS_EMITTER] wsConfig não disponível ainda | Tag: ${tag}`);
      return;
    }

    const payload = JSON.stringify({ [tag]: data });
    let clientesAtivos = 0;

    global.wsConfig.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        clientesAtivos++;
      }
    });

    logger.ws(`[WS_EMITTER] Tag: ${tag} | Clientes: ${clientesAtivos}`);
  }
}

module.exports = new WsEmitter();