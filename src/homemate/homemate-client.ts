import type { AppConfig } from "../config/env.js";
import type { Logger } from "../logging/logger.js";

export interface HomeMateHttpResponse {
  status: number;
  text: string;
  json: unknown;
}

export type HomeMateFetch = typeof fetch;

export class HomeMateClient {
  public constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: HomeMateFetch = fetch,
  ) {}

  public async request(
    method: string,
    path: string,
    options: {
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<HomeMateHttpResponse> {
    const baseUrl = this.config.homeMateApiBaseUrl;
    if (!baseUrl) {
      throw new Error("HOMEMATE_API_BASE_URL is not configured.");
    }

    const url = new URL(path, ensureTrailingSlash(baseUrl));
    const controller = new AbortController();
    const timerId = setTimeout(
      () => controller.abort(),
      this.config.homeMateApiTimeoutMs,
    );
    const headers = this.buildHeaders(options.headers);

    this.logger.info("Calling HomeMate API", {
      method,
      url: url.toString(),
    });

    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        ...(options.body ? { body: options.body } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      const json = tryParseJson(text);

      if (!response.ok) {
        throw new Error(
          `HomeMate API ${method} ${url.pathname} failed with ${response.status}: ${extractErrorMessage(json, text)}`,
        );
      }

      return {
        status: response.status,
        text,
        json,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `HomeMate API timed out after ${this.config.homeMateApiTimeoutMs}ms.`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timerId);
    }
  }

  private buildHeaders(
    headers: Record<string, string> = {},
  ): Record<string, string> {
    const mergedHeaders: Record<string, string> = {
      accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      ...this.config.homeMateApiHeaders,
      ...headers,
    };

    if (this.config.homeMateApiToken) {
      mergedHeaders[this.config.homeMateApiTokenHeader] =
        `${this.config.homeMateApiTokenPrefix}${this.config.homeMateApiToken}`;
    }

    return mergedHeaders;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function tryParseJson(value: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of ["message", "error", "detail", "description"]) {
      const candidate = (parsed as Record<string, unknown>)[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }

  return fallback || "unknown error";
}
