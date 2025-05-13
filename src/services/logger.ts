import { createLogger, format, transports, Logger } from "winston";
import LokiTransport from "winston-loki";

export class LoggerService {
  private logger: Logger;

  constructor() {
    const formater = format.combine(
      format.errors({ stack: true }),
      format((info) => {
        if ((info as any).labels) {
          (info as any).labels = {
            ...((info as any).labels as Record<string, string>),
          };
        }
        return info;
      })(),
      format.json()
    );

    const lokiTransport = new LokiTransport({
      host: process.env.LOKI_URL || "https://loki.virtuals.gg",
      basicAuth:
        process.env.LOKI_USER && process.env.LOKI_PASSWORD
          ? `${process.env.LOKI_USER}:${process.env.LOKI_PASSWORD}`
          : undefined,
      format: formater,
      labels: {
        env: process.env.LOKI_ENV || "local",
        app: "acp-node",
      },
    });

    const consoleTransport = new transports.Console({ format: formater });
    const transportList: any[] = [consoleTransport];
    if (process.env.LOKI_ENV) transportList.push(lokiTransport);

    this.logger = createLogger({ transports: transportList });
  }

  log(message: string, ...context: any[]) {
    this.logger.info(message, { context });
  }

  // Info alias for compatibility with existing logger.info calls
  info(message: string, ...context: any[]) {
    this.logger.info(message, { context });
  }

  error(message: string, ...context: any[]) {
    this.logger.error(message, { context });
  }

  warn(message: string, ...context: any[]) {
    this.logger.warn(message, { context });
  }

  debug(message: string, ...context: any[]) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, ...context: any[]) {
    this.logger.verbose(message, { context });
  }
}

export default LoggerService;
