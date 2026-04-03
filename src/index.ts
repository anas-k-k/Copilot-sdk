import { promises as fs } from "node:fs";
import path from "node:path";

import { loadConfig } from "./config/env.js";
import { buildTelegramSystemPrompt } from "./copilot/prompt.js";
import { CopilotService } from "./copilot/copilot-service.js";
import { FileSearchService } from "./files/file-search-service.js";
import { GoogleWorkspaceService } from "./google-workspace/google-workspace-service.js";
import { HomeMateService } from "./homemate/homemate-service.js";
import { Logger } from "./logging/logger.js";
import { HomeMateActionRegistry } from "./state/homemate-action-registry.js";
import { OutboundFileRegistry } from "./state/outbound-file-registry.js";
import { SkillInstallRegistry } from "./state/skill-install-registry.js";
import { DelegatedJobDispatcher } from "./subagents/job-dispatcher.js";
import { SkillService } from "./skills/skill-service.js";
import { TelegramBot } from "./telegram/telegram-bot.js";
import { TelegramClient } from "./telegram/telegram-client.js";
import { WebcamCaptureService } from "./webcam/webcam-capture-service.js";
import { WebcamVideoService } from "./webcam/webcam-video-service.js";
import { OllamaProvider } from "./providers/ollama-provider.js";
import { OllamaToolRegistry } from "./providers/ollama-tool-registry.js";
import { parseFrontmatter } from "./utils/frontmatter.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger("info");
  const skillService = new SkillService(config, logger);
  const installRegistry = new SkillInstallRegistry();
  const googleWorkspaceService = new GoogleWorkspaceService(config, logger);
  const homeMateService = new HomeMateService(config, logger);
  const homeMateActionRegistry = new HomeMateActionRegistry();
  const fileSearchService = new FileSearchService(config, logger);
  const outboundFileRegistry = new OutboundFileRegistry();
  const webcamCaptureService = new WebcamCaptureService(config, logger);
  const webcamVideoService = new WebcamVideoService(config, logger);
  const delegatedJobDispatcher = new DelegatedJobDispatcher(
    logger,
    config.delegatedJobTimeoutMs,
  );
  const copilotService = new CopilotService(
    config,
    logger,
    skillService,
    installRegistry,
    googleWorkspaceService,
    homeMateService,
    homeMateActionRegistry,
    fileSearchService,
    outboundFileRegistry,
    webcamCaptureService,
    webcamVideoService,
  );
  const telegramClient = new TelegramClient(config, logger);
  const ollamaToolRegistry = new OllamaToolRegistry({
    skillService,
    installRegistry,
    googleWorkspaceService,
    homeMateService,
    homeMateActionRegistry,
    fileSearchService,
    outboundFileRegistry,
    webcamCaptureService,
    webcamVideoService,
  });
  const systemMessage = await buildOllamaSystemMessage();
  const ollamaProvider = new OllamaProvider(
    {
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
      systemMessage,
    },
    undefined,
    ollamaToolRegistry,
  );
  const telegramBot = new TelegramBot(
    telegramClient,
    copilotService,
    skillService,
    installRegistry,
    googleWorkspaceService,
    homeMateService,
    homeMateActionRegistry,
    outboundFileRegistry,
    delegatedJobDispatcher,
    webcamVideoService,
    logger,
    new Set(config.telegramAllowedUserIds),
    config.messageQueueTimeoutMs,
    ollamaProvider,
  );

  registerShutdown(logger, telegramBot, copilotService, webcamVideoService);

  await copilotService.start();
  logger.info("Copilot client started");

  await telegramBot.start();
}

async function buildOllamaSystemMessage(): Promise<string> {
  const base = buildTelegramSystemPrompt("primary");
  const skillBodies = await loadLocalSkillBodies();

  if (skillBodies.length === 0) {
    return base;
  }

  const skillSection = skillBodies
    .map(({ name, body }) => `## Skill: ${name}\n\n${body}`)
    .join("\n\n---\n\n");

  return `${base}\n\n---\n\n# Available Skill Procedures\n\n${skillSection}`;
}

async function loadLocalSkillBodies(): Promise<
  Array<{ name: string; body: string }>
> {
  const skillRoot = path.resolve(process.cwd(), "local-skills");
  const results: Array<{ name: string; body: string }> = [];

  try {
    const entries = await fs.readdir(skillRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillFilePath = path.join(skillRoot, entry.name, "SKILL.md");
      try {
        const markdown = await fs.readFile(skillFilePath, "utf8");
        const parsed = parseFrontmatter(markdown);
        const name = parsed.attributes["name"] ?? entry.name;
        const body = parsed.body.trim();
        if (body) {
          results.push({ name, body });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // local-skills directory doesn't exist or is unreadable
  }

  return results;
}

function registerShutdown(
  logger: Logger,
  telegramBot: TelegramBot,
  copilotService: CopilotService,
  webcamVideoService: WebcamVideoService,
): void {
  let shuttingDown = false;

  const handler = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down", { signal });
    telegramBot.stop();
    webcamVideoService.stopAll();
    await copilotService.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void handler("SIGINT"));
  process.on("SIGTERM", () => void handler("SIGTERM"));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
