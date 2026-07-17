import { format } from 'util';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private level: LogLevel;
  private readonly levelNames: Record<LogLevel, string> = {
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.DEBUG]: 'DEBUG',
  };

  constructor() {
    this.level = Logger.determineLevel();
  }

  private static determineLevel(): LogLevel {
    const debugEnabled = process.env.DEBUG === 'true';
    const logLevelEnv = process.env.LOG_LEVEL;

    if (logLevelEnv) {
      const validLevels: Record<string, LogLevel> = {
        error: LogLevel.ERROR,
        warn: LogLevel.WARN,
        info: LogLevel.INFO,
        debug: LogLevel.DEBUG,
      };
      const normalized = logLevelEnv.toLowerCase();
      const matchedLevel = validLevels[normalized];
      if (matchedLevel !== undefined) {
        return matchedLevel;
      }
      // Invalid LOG_LEVEL: fall back to DEBUG if explicitly requested, else INFO
      return debugEnabled ? LogLevel.DEBUG : LogLevel.INFO;
    }

    return debugEnabled ? LogLevel.DEBUG : LogLevel.INFO;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level <= this.level) {
      const timestamp = new Date().toISOString();
      const levelStr = this.levelNames[level];
      const formattedMessage = format(message, ...args);

      // Always use console.error for MCP servers as stdout is reserved for protocol
      console.error(`[${timestamp}] [${levelStr}] ${formattedMessage}`);
    }
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }
}

export const logger = new Logger();
