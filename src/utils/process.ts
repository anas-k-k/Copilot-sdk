import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecTextOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ExecTextResult {
  stdout: string;
  stderr: string;
}

export type ExecText = (
  command: string,
  args: string[],
  options?: ExecTextOptions,
) => Promise<ExecTextResult>;

export const execFileText: ExecText = async (command, args, options) => {
  const execution = resolveExecution(command, args);
  const result = await execFileAsync(execution.command, execution.args, {
    cwd: options?.cwd,
    env: options?.env,
    timeout: options?.timeoutMs ?? 120_000,
    maxBuffer: 4 * 1024 * 1024,
    shell: execution.shell,
    windowsHide: true,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

interface ResolvedExecution {
  command: string;
  args: string[];
  shell?: boolean;
}

function resolveExecution(command: string, args: string[]): ResolvedExecution {
  const resolvedCommand = resolveCommand(command);
  const extension = path.extname(resolvedCommand).toLowerCase();

  if (isNodeScriptExtension(extension)) {
    return {
      command: process.execPath,
      args: [resolvedCommand, ...args],
    };
  }

  if (
    process.platform === "win32" &&
    usesWindowsCommandShell(resolvedCommand)
  ) {
    return {
      command: resolvedCommand,
      args,
      shell: true,
    };
  }

  return {
    command: resolvedCommand,
    args,
  };
}

function resolveCommand(command: string): string {
  if (process.platform === "win32" && command.toLowerCase() === "npx") {
    return "npx.cmd";
  }

  return command;
}

function isNodeScriptExtension(extension: string): boolean {
  return [".js", ".cjs", ".mjs"].includes(extension);
}

function usesWindowsCommandShell(command: string): boolean {
  const extension = path.extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return true;
  }

  if (extension) {
    return false;
  }

  return (
    !path.isAbsolute(command) &&
    !command.includes("\\") &&
    !command.includes("/")
  );
}
