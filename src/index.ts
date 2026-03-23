import { loadConfig } from "./config/env.js";
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
  );
  const telegramClient = new TelegramClient(config, logger);
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
    logger,
    new Set(config.telegramAllowedUserIds),
    config.messageQueueTimeoutMs,
  );

  registerShutdown(logger, telegramBot, copilotService);

  await copilotService.start();
  logger.info("Copilot client started");

  await telegramBot.start();
}

function registerShutdown(
  logger: Logger,
  telegramBot: TelegramBot,
  copilotService: CopilotService,
): void {
  let shuttingDown = false;

  const handler = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down", { signal });
    telegramBot.stop();
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
