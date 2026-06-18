// Analytics/src/DataBase/Redis/Config/redisConfig.js
const Redis = require('ioredis');

class RedisConfig {
  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.STREAMS = {
      LOG: 'barramento:stream:log',
      HEALTH: 'barramento:stream:health',
      ALERTS: 'barramento:stream:alerts'
    };

    this.HASHES = {
      ENGINE_STATE: 'motor:engine:state',
      ACTUATORS_STATE: 'motor:actuators:state'
    };

    this._initEvents();
  }

  _initEvents() {
    this.client.on('connect', () => console.log('🧠 [REDIS] Analytics conectado com sucesso.'));
    this.client.on('error', (err) => console.error('🚨 [REDIS] Erro no Redis:', err.message));
  }

  /**
   * Método padrão de leitura bloqueante para o Worker escutar a saúde
   */
  async readStream(streamKey, lastId = '$', count = 1) {
    try {
      return await this.client.xread('COUNT', count, 'BLOCK', 5000, 'STREAMS', streamKey, lastId);
    } catch (err) {
      console.error(`❌ [REDIS] Erro ao ler stream ${streamKey}:`, err.message);
      return null;
    }
  }
}

module.exports = new RedisConfig();