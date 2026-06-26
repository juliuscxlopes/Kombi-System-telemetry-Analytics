// src/Infra/websocket/WsEmitter.js
const WebSocket = require('ws');
const wsConfig = require('./WsConfig');

class WsEmitter {
  broadcast(tag, data) {
    const payload = JSON.stringify({ [tag]: data });

    wsConfig.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}

module.exports = new WsEmitter();