const Redis = require('ioredis');
require('dotenv').config();

class RedisConfig {
  constructor() {
    
    this.client = new Redis({
      
      host: process.env.REDIS_HOST || 'redis-msg-center',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || undefined, 
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 50, 2000), // Reconexão agressiva para ambiente embarcado
    });
    this.client = new Redis(client);
    this.subClient = new Redis(client);
    
    // 🎯 Chaves únicas, namespaces e centralizadas (Single Source of Truth)
    this.STREAMS = {
      LOG: 'History:stream:log',// Linha do tempo central
    };

    this.HASHES = {
      ENGINE_STATE: 'motor:engine:state',
      ACTUATORS_STATE: 'motor:actuators:state',
      ALERTS: 'motor:alerts:state', 
      METRICS: 'motor:metrics:state',
      DAMAGE_ALERTS: 'motor:damage:state',                          
    };

    // 📢 Cliente dedicado EXCLUSIVAMENTE para escuta (SUBSCRIBE)
    this.STREAMS = { LOG: 'History:stream:log' };
    this.HASHES = { /* ... seus hashes ... */ };
    this.CHANNELS = {
      TELEMETRY: 'channel:telemetry',
      ALERTS: 'channel:alerts',
    };

    this._initEvents();
    
  }
  

  _initEvents() {
    this.client.on('connect', () => console.log('🧠 [CORE-REDIS] Conectado ao Barramento Central via Kernel.'));
    this.client.on('error', (err) => console.error('🚨 [CORE-REDIS] Erro de conexão no barramento:', err.message));
  }
}

module.exports = new RedisConfig();