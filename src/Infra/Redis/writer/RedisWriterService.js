// src/Infra/Redis/writer/RedisWriterService.js
const redisConfig = require('../config/redisConfig');
const logger = require('../../../log/logger');

class RedisWriterService {
  /**
   * Writer agnóstico — cada chamador decide o que gravar.
   * Nenhum campo é obrigatório sozinho; combine conforme o fluxo precisa.
   *
   * @param {object} opts
   * @param {string} [opts.hashKey]   - chave do hash (ex: redisConfig.HASHES.METRICS)
   * @param {string} [opts.field]     - campo dentro do hash (ex: sensorName)
   * @param {string} [opts.channel]   - canal de publish (ex: redisConfig.CHANNELS.METRICS)
   * @param {object} opts.payload     - dado a ser serializado (obrigatório)
   * @param {string} [opts.streamKey] - se também precisar gravar em stream
   * @param {number} [opts.streamLimit=5000]
   */
  async write({ hashKey, field, channel, payload, streamKey, streamLimit = 5000 } = {}) {
    if (!redisConfig?.client) {
      logger.error('❌ [WRITER] Redis não inicializado.');
      return;
    }
    if (!payload) {
      logger.warn('⚠️  [WRITER] Chamado sem payload — abortando.');
      return;
    }

    const dataString = JSON.stringify(payload);
    const tasks = [];

    if (hashKey && field) {
      tasks.push(
        redisConfig.client.hset(hashKey, field, dataString)
          .then(() => logger.info(`[HASH] ${field} atualizado em ${hashKey}.`))
          .catch(err => logger.error(`[HASH_FAIL] ${field} em ${hashKey}: ${err.message}`))
      );
    }

    if (streamKey) {
      tasks.push(
        redisConfig.client.xadd(streamKey, 'MAXLEN', '~', streamLimit, '*', 'field', field ?? 'n/a', 'data', dataString)
          .then(() => logger.info(`[STREAM] Entrada injetada em ${streamKey}.`))
          .catch(err => logger.error(`[STREAM_FAIL] ${streamKey}: ${err.message}`))
      );
    }

    if (channel) {
      tasks.push(
        redisConfig.client.publish(channel, dataString)
          .then(count => logger.info(`[PUBSUB] Publicado em ${channel} | subscribers=${count}`))
          .catch(err => logger.error(`[PUBSUB_FAIL] ${channel}: ${err.message}`))
      );
    }

    await Promise.allSettled(tasks);
  }
}

module.exports = new RedisWriterService();