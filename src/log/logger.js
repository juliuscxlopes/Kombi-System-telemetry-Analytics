const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file'); // Gerencia tamanho e rotação dos arquivos .txt

// 1. Níveis customizados e hierarquia de importância do ecossistema da Kombi
const customLevels = {
  levels: {
    error: 0,      // Falha crítica (Hardware, Sensor morto, Conexão Redis caída)
    warn: 1,       // Alerta mecânico/eletrônico (Ex: Temperatura subindo, flutuação de tensão)
    ws: 2,         // Comunicação WebSockets com os Atuadores (Comandos ativos)
    stream: 3,     // Dados despachados para as chaves do Redis (Publisher)
    serial: 4,     // Leitura bruta chegando da Serial Bridge / Hardware
    info: 5,       // Inicialização do sistema e mensagens de status genéricas
    debug: 6       // Detalhes profundos de engenharia para depuração em bancada
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    ws: 'magenta',     // Magenta destaca comandos rápidos de atuadores
    stream: 'cyan',    // Cyan foca na saída de dados para o barramento
    serial: 'green',   // Verde limpo para leitura saudável dos sensores
    info: 'blue',
    debug: 'gray'      // Discreto para não poluir o terminal visualmente
  }
};

winston.addColors(customLevels.colors);

// 2. Formatação visual cirúrgica para o Terminal (Console)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), // Precisão em milissegundos
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level}]: ${info.message}`
  )
);

// 3. Formatação limpa para os Arquivos .txt (Sem códigos de cor ansi que poluem o texto)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`
  )
);

const logger = winston.createLogger({
  levels: customLevels.levels,
  transports: [
    // --- MONITORAMENTO EM TEMPO REAL ---
    new winston.transports.Console({
      level: 'debug', // No console mostra tudo do mais crítico até o debug
      format: consoleFormat
    }),

    // --- REDUNDÂNCIA FÍSICA & DIÁRIO DE BORDO (ROTAÇÃO AUTOMÁTICA) ---
    // Cria arquivos diários: 'kombi-telemetry-2026-06-16.log'
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../../logs/kombi-telemetry-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,              // Compacta logs antigos em .gz para economizar espaço
      maxSize: '20m',                   // Capa cada arquivo em no máximo 20 Megabytes
      maxFiles: '14d',                  // Retém o histórico das últimas 2 semanas de viagens, apagando o resto
      level: 'serial',                  // Salva tudo de 'serial' para cima (ignora apenas o debug pesado)
      format: fileFormat
    }),

    // --- ARQUIVO ISOLADO PARA ERROS CRÍTICOS ---
    new winston.transports.DailyRotateFile({
      filename: path.join(__dirname, '../../../logs/critical-errors-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',                   // Registra estritamente falhas gravíssimas do sistema
      format: fileFormat
    })
  ]
});

module.exports = logger;