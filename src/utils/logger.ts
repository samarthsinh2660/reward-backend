import winston from 'winston';

export const createLogger = (label: string) =>
    winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.label({ label }),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, label, timestamp }) => {
                return `${timestamp} [${label}] ${level}: ${message}`;
            })
        ),
        transports: [new winston.transports.Console()],
    });
