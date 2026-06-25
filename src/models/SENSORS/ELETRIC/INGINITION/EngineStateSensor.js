const redis = require('../../../../Redis/Config/redisConfig');

class IgnitionSensor {
  constructor() {
    this.name = 'ignition_switch';
    this.value = 0; // 0: Desligado, 1: Ligado
    this.isHardwareOk = true;
  }

  update(val) {
    // Validação de Hardware (ex: se o ESP32 mandar erro de leitura no pino)
    if (String(val).startsWith('err')) {
      this.isHardwareOk = false;
      this.value = 0;
    } else {
      this.isHardwareOk = true;
      // Garante que o valor seja binário (0 ou 1)
      this.value = Number(val) > 0 ? 1 : 0;
    }

    this.publish();
  }

  publish() {
    const sensorState = {
      val: this.value, 
      ok: this.isHardwareOk,
      ts: Date.now()
    };

    // Publica na Stream Electric (Saúde do Hardware/Fiação)
    redis.client.xadd('kombi:stream:electric', '*', 
      'sensor', this.name, 
      'data', JSON.stringify(sensorState)
    ).catch(err => console.error(`Erro Stream Electric (${this.name}):`, err));
  }
}

module.exports = IgnitionSensor;