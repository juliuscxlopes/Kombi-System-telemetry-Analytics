//src/infra/websocket/WsEmitter.js
const wsEmitter = require('../WsEmitter');

class ActuatorEmitter {

  dispatch(predictive) {
    if (!predictive) return;

    wsEmitter.broadcast(predictive.actuator, {
      intensity: predictive.intensity,
      tipo: predictive.tipo,
      description: predictive.description,
      timestamp: Date.now()
    });
  }

}

module.exports = new ActuatorEmitter();