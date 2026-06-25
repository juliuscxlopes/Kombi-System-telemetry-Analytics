const redisConfig = require('../config/redisConfig');

class PublisherService {
  constructor() {
    // Pega o mapeamento centralizado de streams do redisConfig
    this.streams = redisConfig.STREAMS;
  }

  /**
   * 🚀 MÉTODO PRINCIPAL: Publicação genérica Fire-and-Forget usando XADD
   * Desacoplado de regras de negócio, publica qualquer payload na stream especificada.
   * * @param {string} streamName - Nome da stream (Ex: redisConfig.STREAMS.DIAGNOSIS)
   * @param {Object|Array} payloadData - Dados estruturados do evento
   * @param {Object} options - Metadados adicionais para rastreabilidade (Opcional)
   */
  publish(streamName, payloadData, options = {}) {
    try {
      // Garante que o streamName passado existe no nosso Single Source of Truth
      const targetStream = Object.values(this.streams).includes(streamName) 
        ? streamName 
        : this.streams.LOG; // Fallback seguro para LOG se a stream for desconhecida

      // Agrega o payload base com eventuais opções de rastreamento/metadados
      const envelope = {
        ...payloadData,
        _meta: {
          published_at: new Date().toISOString(),
          ...options
        }
      };

      // Utiliza o XADD do ioredis de forma assíncrona, fire-and-forget, sem travar o event loop
      redisConfig.client.xadd(targetStream, '*', 'payload', JSON.stringify(envelope))
        .catch(err => console.error(`❌ [PUBLISHER-SERVICE] Falha ao publicar na stream ${targetStream}:`, err.message));

    } catch (err) {
      console.error(`❌ [PUBLISHER-SERVICE] Erro crítico no envelope do publisher:`, err.message);
    }
  }

  /**
   * 💡 MÉTODOS AUXILIARES (Opcionais / Mantidos para retrocompatibilidade sem quebrar nada)
   * Apenas encapsulam a chamada do publish principal apontando para as chaves centrais.
   */
  health(streamName, payload, options = {}) {
    this.publish(streamName, payload, options);
  }

  actuator(payload, options = {}) {
    this.publish(this.streams.CONTAINMENT, payload, options);
  }

  log(eventoDescricao, estagioAtual = 'nominal', options = {}) {
    const logPayload = {
      event: eventoDescricao,
      status: estagioAtual,
      ts: Date.now()
    };
    this.publish(this.streams.LOG, logPayload, options);
  }
}

module.exports = new PublisherService();