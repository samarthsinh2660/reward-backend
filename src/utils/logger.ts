import winston from 'winston';

export const createLogger = (label: string) => {
    const instance = winston.createLogger({
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

    return {
        info: (msg: string) => instance.info(msg),
        warn: (msg: string) => instance.warn(msg),
        error: (msg: string, err?: Error | unknown) => {
            const detail = err instanceof Error
                ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
                : err != null ? String(err) : '';
            instance.error(detail ? `${msg} — ${detail}` : msg);
        },
    };
};
