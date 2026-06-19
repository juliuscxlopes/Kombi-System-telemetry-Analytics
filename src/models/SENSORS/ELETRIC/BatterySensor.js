const AlertManager = require('../../../..Redis/Publisher/AlertPublisher');

class BatteryHealthModel {
  constructor(specs) {
    this.name = 'BATTERY';
    this.isHardwareOk = true;
  }

  // O Analytics recebe o valor que o Core já limpou e postou na stream:engine
  analisar(val, hardwareStatus) {
    this.isHardwareOk = hardwareStatus;
    const volts = Number(val);

    // LÓGICA DE ENCAMINHAMENTO (A "Maldade" do Negócio)

    // Sempre atualiza o Health (O display e o Cérebro precisam saber o estado atual)
    publisher.publish('health', this.name, {
      val: volts,
      label: analise.label,
      status: analise.status,
      ts: Date.now()
    });

    // SE FOR CRÍTICO (Status 4 ou 5), GERA ALERTA
    if (analise.status >= 4) {
      AlertManager.send('alerts', this.name, {
        nivel: 'CRITICAL',
        msg: `Voltagem Baixa: ${volts}V`,
        severidade: analise.severidade,
        status: analise.status,
        ts: Date.now()
      });
    }

    // Se estiver CARREGANDO, podemos até mandar um evento de "INFO" se quiser
    if (analise.label === 'CARREGANDO') {
       console.log("🔋 [INFO] Alternador operando corretamente.");
    }
  }

  _processarRegras(volts) {
    if (!this.isHardwareOk) return { label: 'SENSOR_ERROR', status: 5, severidade: 5 };

    // Regra de Negócio Pura
    if (volts >= (this.specs.bat_charging || 13.5)) {
      return { label: 'CARREGANDO', status: 1, severidade: 0 };
    }

    if (volts < (this.specs.bat_low || 11.5)) {
      return { label: 'BAIXA', status: 5, severidade: 4 };
    }

    return { label: 'NOMINAL', status: 2, severidade: 0 };
  }
}

module.exports = BatteryHealthModel;