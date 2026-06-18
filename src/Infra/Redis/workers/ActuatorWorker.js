// src/workers/ActuatorWorker.js
const redisConfig = require('../Redis/Config/redisConfig');

class ActuatorWorker {
  constructor() {
    this.NAME = 'ACTUATOR_WORKER';
    this.HEALTH_STREAM = 'stream:health';
    this.ACTUATORS_STREAM = 'stream:actuators';
    this.STATE_HASH = 'kombi:active:plans';
    this.is_running = false;
  }

  /**
   * PONTO DE ENTRADA: Loop de leitura bloqueante na stream health
   */
  async iniciar() {
    this.is_running = true;
    console.log(`🚀 [${this.NAME}] Worker de atuação iniciado. Escutando ${this.HEALTH_STREAM}...`);

    let lastId = '$'; 

    while (this.is_running) {
      try {
        const resposta = await redisConfig.client.xread(
          'BLOCK', 5000,
          'STREAMS', this.HEALTH_STREAM, lastId
        );

        if (!resposta) continue;

        const [stream, registros] = resposta[0];

        for (const [id, campos] of registros) {
          lastId = id; 
          
          const payloadIdx = campos.indexOf('payload');
          if (payloadIdx === -1) continue;

          const healthData = JSON.parse(campos[payloadIdx + 1]);
          
          // Foco no OIL_TEMP e garante que existe um diagnóstico válido
          if (healthData.sensor === 'OIL_TEMP' && healthData.diagnosis) {
            await this._orquestrarAtuadores(healthData.sensor, healthData.diagnosis);
          }
        }
      } catch (err) {
        // Corrigido o template string que estava quebrado aqui
        console.error(`❌ [${this.NAME}] Erro no loop de leitura do Worker:`, err.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * LÓGICA DE ATUADORES: Avalia o diagnóstico e despacha para a stream física
   */
  async _orquestrarAtuadores(sensorName, diagnosis) {
    try {
      const { contention, active_rule } = diagnosis;
      const { plan, value, solution } = contention;

      // Se o plano morreu ou está estável, limpa a hash e encerra de forma segura
      if (!plan || plan === 'none' || !solution || solution.length === 0) {
        await redisConfig.client.hdel(this.STATE_HASH, sensorName);
        return;
      }

      // FRESH CHECK NA HASH DE PLANOS
      const ultimoEstadoRaw = await redisConfig.client.hget(this.STATE_HASH, sensorName);
      let precisaAtualizar = false;

      if (!ultimoEstadoRaw) {
        // Se não existia plano antes, precisa atualizar com certeza
        precisaAtualizar = true;
      } else {
        const ultimoEstado = JSON.parse(ultimoEstadoRaw);
        // 🎯 Se o valor mudou OU se a regra de origem mudou (mesmo mantendo os 50%), a gente atualiza!
        if (ultimoEstado.value !== value || ultimoEstado.active_rule !== active_rule) {
          precisaAtualizar = true;
        }
      }

      // Se a avaliação mudou de patamar ou mudou de regra, dispara a telemetria física
      if (precisaAtualizar) {
        const estadoAtualizado = { plan, value, active_rule, timestamp: Date.now() };
        
        // Grava o estado atualizado na Hash
        await redisConfig.client.hset(this.STATE_HASH, sensorName, JSON.stringify(estadoAtualizado));

        // Despacha o comando individual para cada atuador ativo na solução
        for (const atuador of solution) {
          const payloadComando = {
            atuador,
            comando: value === '0%' ? 'OFF' : 'ACTIVE',
            frequencia_pwm: value, // "25%", "50%", "75%", "100%"
            origem_regra: active_rule,
            ts: Date.now()
          };

          // Joga direto na stream que a controladora / ESP32 está escutando fisicamente
          await redisConfig.client.xadd(this.ACTUATORS_STREAM, '*', 'payload', JSON.stringify(payloadComando));
          
          console.log(`⚡ [${this.NAME}] [${atuador}] Comando enviado: ${value} (Regra: ${active_rule})`);
        }
      }

    } catch (err) {
      console.error(`❌ [${this.NAME}] Erro ao orquestrar atuadores para ${sensorName}:`, err.message);
    }
  }

  parar() {
    this.is_running = false;
    console.log(`🛑 [${this.NAME}] Parando worker de atuação...`);
  }
}

module.exports = new ActuatorWorker();