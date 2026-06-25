const WebSocket = require('ws');
const http = require('http');

class WsConfig {
  constructor(port = 3000) {
    this.server = http.createServer();
    this.wss = new WebSocket.Server({ noServer: true });

    // Previne que conexões HTTP simples fiquem penduradas
    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.port = port;
  }

  start(callback) {
    this.server.listen(this.port, () => {
      if (callback) callback(this.port);
    });
  }
}

module.exports = WsConfig;