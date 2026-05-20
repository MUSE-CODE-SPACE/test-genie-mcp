/**
 * Security utilities for test-genie-mcp.
 *
 * Provides:
 *   - Capability-based path safety (validatePathWithinAllowedRoot)
 *     test-genie only operates inside the directory it was launched from
 *     (or TEST_GENIE_ALLOWED_ROOT if explicitly set).
 *   - Command/argument validation for subprocess execution.
 *     User-controlled values must be passed as argv arrays via child_process.spawn,
 *     never concatenated into shell strings.
 *   - A small structured ToolError class compatible with MCP CallToolResult shape.
 *
 * Imported from the vibe-coding-mcp `core/security.ts` baseline (Phase 1).
 */

import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// ToolError
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PATH_TRAVERSAL'
  | 'COMMAND_INJECTION'
  | 'EXECUTABLE_NOT_ALLOWED'
  | 'PLATFORM_ERROR'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT';

export interface ErrorContext {
  tool?: string;
  platform?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export class ToolError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: ErrorContext;
  public readonly timestamp: string;

  constructor(message: string, code: ErrorCode, context?: ErrorContext) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace?.(this, ToolError);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}

// ---------------------------------------------------------------------------
// Capability-based path safety
// ---------------------------------------------------------------------------

/**
 * Returns the configured allowed root directory.
 *
 * Priority:
 *   1. TEST_GENIE_ALLOWED_ROOT env var (if set and resolvable).
 *   2. process.cwd() — i.e. the directory the MCP server was launched from.
 *
 * All file-system operations (and tools that touch user project paths) must
 * pass their target through `validatePathWithinAllowedRoot` before use.
 */
export function getAllowedRoot(): string {
  const envRoot = process.env.TEST_GENIE_ALLOWED_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot);
  }
  return path.resolve(process.cwd());
}

/**
 * Validates that a file/directory path stays within the configured allowed root.
 * Throws `ToolError(code='PATH_TRAVERSAL')` otherwise.
 *
 * Use this for ANY tool argument that names a path under the user's filesystem.
 */
export function validatePathWithinAllowedRoot(filePath: string, allowedRoot: string = getAllowedRoot()): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new ToolError('Path must be a non-empty string', 'VALIDATION_ERROR', { filePath });
  }

  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedRoot = path.resolve(allowedRoot);

  if (resolvedPath !== resolvedAllowedRoot && !resolvedPath.startsWith(resolvedAllowedRoot + path.sep)) {
    throw new ToolError(
      'Path traversal detected: target escapes allowed root',
      'PATH_TRAVERSAL',
      { filePath, allowedRoot: resolvedAllowedRoot, resolved: resolvedPath }
    );
  }

  return resolvedPath;
}

/**
 * Validates `validatePathWithinAllowedRoot` AND that the path actually exists.
 */
export function validateExistingPathWithinAllowedRoot(filePath: string, allowedRoot: string = getAllowedRoot()): string {
  const resolved = validatePathWithinAllowedRoot(filePath, allowedRoot);
  if (!fs.existsSync(resolved)) {
    throw new ToolError('Path does not exist', 'NOT_FOUND', { filePath: resolved });
  }
  return resolved;
}

/**
 * Sanitizes a filename to prevent path traversal and invalid characters.
 */
export function sanitizeFilename(filename: string, maxLength = 200): string {
  return filename
    .replace(/\.\./g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Command / subprocess safety
// ---------------------------------------------------------------------------

/**
 * Executables that test-genie is allowed to invoke. Anything outside this
 * allowlist will throw EXECUTABLE_NOT_ALLOWED.
 *
 * NOTE: this is an allow-list of *names* (not absolute paths). The actual
 * argv[0] passed to spawn must resolve to an executable on PATH that matches
 * one of these names.
 */
export const ALLOWED_EXECUTABLES: ReadonlySet<string> = new Set([
  // iOS
  'xcrun', 'xcodebuild', 'simctl', 'instruments', 'leaks',
  // Android
  'adb', 'emulator', 'gradle', 'gradlew',
  // Flutter
  'flutter', 'dart',
  // React Native / Node
  'node', 'npm', 'npx', 'yarn', 'pnpm', 'jest',
  // Web / browsers
  'playwright', 'cypress', 'chrome', 'chromium',
  // Generic
  'git', 'sh', 'bash', 'curl', 'open', 'pkill',
]);

const SHELL_METACHARS = /[;&|`$<>(){}[\]\\!*?~\n\r]/;

/**
 * Validates a single argv element. Rejects shell metacharacters that could
 * enable command injection if the value were ever passed to a shell.
 *
 * Used defensively even when calling spawn() with argv arrays — guards
 * against future regressions where someone refactors to exec().
 */
export function validateCommandArg(arg: string, context: ErrorContext = {}): string {
  if (typeof arg !== 'string') {
    throw new ToolError('Command argument must be a string', 'VALIDATION_ERROR', { ...context, arg });
  }
  if (SHELL_METACHARS.test(arg)) {
    throw new ToolError(
      'Command argument contains shell metacharacters',
      'COMMAND_INJECTION',
      { ...context, arg }
    );
  }
  return arg;
}

/**
 * Validates a (command, args[]) pair before spawning.
 * Returns the validated tuple — callers should use the return value, not the
 * original input.
 */
export function validateCommand(command: string, args: string[], context: ErrorContext = {}): { command: string; args: string[] } {
  if (!ALLOWED_EXECUTABLES.has(command)) {
    throw new ToolError(
      `Executable not in allow-list: ${command}`,
      'EXECUTABLE_NOT_ALLOWED',
      { ...context, command, allowed: Array.from(ALLOWED_EXECUTABLES) }
    );
  }
  const validatedArgs = args.map((a) => validateCommandArg(a, { ...context, command }));
  return { command, args: validatedArgs };
}
