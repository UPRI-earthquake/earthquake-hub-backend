const appRoot = require('app-root-path');
const winston = require('winston');

// define the custom settings for each transport (file, console)
const options = {
  /*
  file: {
    level: "info",
    filename: `${appRoot}/logs/app.log`,
    handleExceptions: true,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
  },
  */
  console: {
    level: "debug",
    handleExceptions: true,
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ip }) => {
      //winston.format.printf(({ timestamp, level, message }) => {
        //return `${timestamp} [${level}] ${message}`;
        if (ip) {
          return `${timestamp} [${level}] - ${ip} - ${message}`;
        } else {
          return `${timestamp} [${level}] ${message}`;
        }
      })

    ),
  },
};

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(options.console),
  ],
  exitOnError: false, // do not exit on handled exceptions
});

module.exports = logger;
