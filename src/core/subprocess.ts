/**
 * Hardened subprocess helpers — `spawn` with argv arrays, executable
 * allowlist, validated args. Replaces ~30 `execAsync(commandStr)` sites that
 * accumulated across the platform modules in v2.x.
 *
 * Why: `exec(string)` invokes a shell, which means any user-controlled value
 * spliced into the command (scheme, device, package name, etc.) is shell-
 * interpreted. Even when the immediate caller looks safe, a refactor can
 * silently introduce injection. Going through `spawn(cmd, argv[])` and
 * validating each argv element makes this category of bug a type error.
 */

import { spawn, SpawnOptions } from 'child_process';
import {
  ALLOWED_EXECUTABLES,
  ToolError,
  validateCommandArg,
  validateCommand,
} from '../security.js';

export interface RunProcessOptions {
  /** Working directory. Will be passed to spawn. */
  cwd?: string;
  /** Timeout in ms. Default: 60_000. */
  timeout?: number;
  /** Max stdout/stderr buffer in bytes. Default: 50 MB. */
  maxBuffer?: number;
  /** Environment variables (merged on top of process.env). */
  env?: NodeJS.ProcessEnv;
  /** When true, do not throw on non-zero exit — return the exit code instead. */
  ignoreExitCode?: boolean;
  /** Skip the allowlist check (use only for shells/launchers that have been audited separately). */
  skipAllowlist?: boolean;
}

export interface RunProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  /** True when the process was killed by the timeout. */
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * Common identifier-shaped values (devices, schemes, package names…). Allows
 * letters, digits, dots, underscores, dashes. Used to validate user input
 * that gets passed as an argv element to a platform tool.
 */
export const ID_ALLOWLIST = /^[A-Za-z0-9._-]+$/;

/**
 * Slightly looser — adds `/` and `:` so xcodebuild destinations
 * (`platform=iOS Simulator,name=...`) can come through. Still rejects shell
 * metacharacters.
 */
export const DESTINATION_ALLOWLIST = /^[A-Za-z0-9._=,:/ -]+$/;

/**
 * Validate that `value` matches the supplied regex; throws ToolError otherwise.
 */
export function ensureMatches(value: string, regex: RegExp, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError(`${name} is required`, 'VALIDATION_ERROR', { value });
  }
  if (!regex.test(value)) {
    throw new ToolError(
      `${name} contains disallowed characters`,
      'COMMAND_INJECTION',
      { value, name, expected: regex.source },
    );
  }
  return value;
}

/**
 * Promise wrapper around `child_process.spawn` with argv arrays, allowlist
 * enforcement, timeout, and bounded buffers.
 *
 * Usage:
 *   const { stdout } = await runProcess('xcrun', ['simctl', 'list', 'devices', '-j']);
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<RunProcessResult> {
  if (!options.skipAllowlist) {
    validateCommand(command, args, { tool: 'runProcess' });
  } else {
    // Still validate args even if executable check is skipped.
    args.forEach((a) => validateCommandArg(a, { command }));
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

  const spawnOpts: SpawnOptions = {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    // Critical: false. Never pass user input to a shell.
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  return new Promise<RunProcessResult>((resolve, reject) => {
    const child = spawn(command, args, spawnOpts);

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;
    let timedOut = false;
    let bufferExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Forceful kill if SIGTERM is ignored.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxBuffer) {
        bufferExceeded = true;
        child.kill('SIGTERM');
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > maxBuffer) {
        bufferExceeded = true;
        child.kill('SIGTERM');
        return;
      }
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new ToolError(
          `spawn failed for ${command}: ${err.message}`,
          'INTERNAL_ERROR',
          { command, args },
        ),
      );
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (bufferExceeded) {
        reject(
          new ToolError(
            `${command} exceeded ${maxBuffer} bytes of output`,
            'INTERNAL_ERROR',
            { command },
          ),
        );
        return;
      }
      const result: RunProcessResult = {
        stdout,
        stderr,
        exitCode: code ?? -1,
        signal,
        timedOut,
      };
      if (timedOut) {
        reject(
          new ToolError(
            `${command} timed out after ${timeout}ms`,
            'TIMEOUT',
            { command },
          ),
        );
        return;
      }
      if (!options.ignoreExitCode && code !== 0) {
        reject(
          new ToolError(
            `${command} exited with status ${code}: ${stderr.slice(0, 500)}`,
            'PLATFORM_ERROR',
            { command, exitCode: code },
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Fire-and-forget background spawn (e.g., screen recording). Returns the
 * child object so callers can kill or wait on it. Allowlist is enforced.
 */
export function spawnBackground(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): import('child_process').ChildProcess {
  validateCommand(command, args, { tool: 'spawnBackground' });
  return spawn(command, args, {
    shell: false,
    stdio: 'pipe',
    ...options,
  });
}

export { ALLOWED_EXECUTABLES };
