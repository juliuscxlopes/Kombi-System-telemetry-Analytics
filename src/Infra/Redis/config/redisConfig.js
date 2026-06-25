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
    
    // 🎯 Chaves únicas, namespaces e centralizadas (Single Source of Truth)
    this.STREAMS = {
      LOG: 'barramento:stream:log',                    // Linha do tempo central (Append-Only / XADD)
      HEALTH: 'barramento:stream:health',              // 
      
    };

    this.HASHES = {
      ENGINE_STATE: 'motor:engine:state',              // Foto instantânea e atualizada dos sensores
      ACTUATORS_STATE: 'motor:actuators:state',        // Estado atual dos atuadores físicos
      ALERTS: 'motor:alerts:state',                    // Quadro de Alertas Ativos (tracking de contenção)
    };

    this._initEvents();
  }

  _initEvents() {
    this.client.on('connect', () => console.log('🧠 [CORE-REDIS] Conectado ao Barramento Central via Kernel.'));
    this.client.on('error', (err) => console.error('🚨 [CORE-REDIS] Erro de conexão no barramento:', err.message));
  }
}

module.exports = new RedisConfig();