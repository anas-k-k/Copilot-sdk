export type LogLevel = "debug" | "info" | "warn" | "error";

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  public constructor(private readonly minimumLevel: LogLevel = "info") {}

  public debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (priorities[level] < priorities[this.minimumLevel]) {
      return;
    }

    const payload = context ? ` ${JSON.stringify(context)}` : "";
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${payload}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}
