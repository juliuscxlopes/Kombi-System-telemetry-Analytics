const winston = require('winston');

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    ws: 2,
    stream: 3,
    serial: 4,
    info: 5,
    debug: 6
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    ws: 'magenta',
    stream: 'cyan',
    serial: 'green',
    info: 'blue',
    debug: 'gray'
  }
};

winston.addColors(customLevels.colors);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level}]: ${info.message}`
  )
);

const logger = winston.createLogger({
  levels: customLevels.levels,
  transports: [
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  ]
});

module.exports = logger;