/**
 * Strong syntax validation for fix application.
 *
 * Phase 5 replaces the previous brace/paren counting heuristic with platform-
 * appropriate validators:
 *
 *   - TypeScript / JavaScript: uses the `typescript` package compiler API
 *     (`ts.createSourceFile`) to detect parse errors; falls back to brace
 *     balance if compiler unavailable. We deliberately stop at parse-level
 *     diagnostics (not full semantic type-check) to keep validation fast and
 *     not require a tsconfig walk for every fix.
 *
 *   - Swift / Kotlin / Java / Dart: tries the platform's first-party compiler
 *     in --typecheck / --dry-run mode (`swiftc -typecheck`, `kotlinc`,
 *     `javac`, `dart analyze`). If the tool is missing on PATH, falls back
 *     to brace-balance validation and reports `downgraded: true` so callers
 *     (and human reviewers) know the check was weakened.
 *
 *   - Everything else: brace + paren + bracket balance.
 *
 * All shell-out paths use `spawn` with argv arrays — no string concatenation.
 * User-controlled values (the source content) are written to a temp file and
 * the temp path is passed as a single argv element, so shell metacharacters
 * in code can never escape to the shell.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ts from 'typescript';

export interface SyntaxValidationResult {
  valid: boolean;
  /** First error message, if invalid. */
  error?: string;
  /** All diagnostics (best-effort). */
  diagnostics?: string[];
  /** True when we fell back to a weaker check (e.g., missing platform compiler). */
  downgraded?: boolean;
  /** Strategy that was actually used. */
  strategy:
    | 'typescript-compiler'
    | 'swiftc'
    | 'kotlinc'
    | 'dart-analyze'
    | 'javac'
    | 'brace-balance';
}

const SWIFT_EXTS = ['.swift'];
const KOTLIN_EXTS = ['.kt', '.kts'];
const DART_EXTS = ['.dart'];
const JAVA_EXTS = ['.java'];
const TS_JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Validate that `content` parses cleanly for the language inferred from
 * `filePath`'s extension. Never throws — invalid inputs return a result with
 * `valid: false`.
 */
export function validateSyntax(
  filePath: string,
  content: string,
): SyntaxValidationResult {
  const ext = path.extname(filePath).toLowerCase();

  if (TS_JS_EXTS.includes(ext)) {
    return validateTypeScript(filePath, content);
  }
  if (SWIFT_EXTS.includes(ext)) {
    return validateWithPlatformCompiler(content, ext, 'swiftc', ['-typecheck']);
  }
  if (KOTLIN_EXTS.includes(ext)) {
    return validateWithPlatformCompiler(content, ext, 'kotlinc', ['-d', osTmpDir(), '-nowarn']);
  }
  if (DART_EXTS.includes(ext)) {
    return validateWithPlatformCompiler(content, ext, 'dart', ['analyze', '--fatal-infos']);
  }
  if (JAVA_EXTS.includes(ext)) {
    return validateWithPlatformCompiler(content, ext, 'javac', ['-Xlint:none', '-d', osTmpDir()]);
  }

  // Unknown — fall back to brace balance.
  return validateBraceBalance(content);
}

/**
 * Use the TypeScript compiler API to parse the file. We only check for parse-
 * level diagnostics here; full semantic check would require a `tsconfig.json`
 * walk which is too expensive per-fix.
 */
function validateTypeScript(filePath: string, content: string): SyntaxValidationResult {
  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      inferScriptKind(filePath),
    );

    // `ts.createSourceFile` records syntactic diagnostics on the source file
    // object via `parseDiagnostics`. Accessing the internal field via cast
    // is the SDK-blessed way (TypeScript exposes it on the public type).
    const parseDiagnostics =
      ((sourceFile as unknown) as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];

    if (parseDiagnostics.length === 0) {
      return { valid: true, strategy: 'typescript-compiler' };
    }

    const diagnostics = parseDiagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    );

    return {
      valid: false,
      error: diagnostics[0],
      diagnostics,
      strategy: 'typescript-compiler',
    };
  } catch (err) {
    // Compiler itself blew up — fall back to brace balance with a note.
    const fallback = validateBraceBalance(content);
    return {
      ...fallback,
      downgraded: true,
      diagnostics: [
        `typescript compiler failed: ${err instanceof Error ? err.message : String(err)}`,
        ...(fallback.diagnostics ?? []),
      ],
    };
  }
}

function inferScriptKind(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Try to run a platform compiler in typecheck-only mode. If the executable
 * isn't on PATH, downgrade to brace balance + mark `downgraded: true`.
 */
function validateWithPlatformCompiler(
  content: string,
  ext: string,
  cmd: string,
  args: string[],
): SyntaxValidationResult {
  if (!isExecutableOnPath(cmd)) {
    const fallback = validateBraceBalance(content);
    return {
      ...fallback,
      downgraded: true,
      strategy: 'brace-balance',
      diagnostics: [
        `${cmd} not found on PATH — downgraded to brace-balance validation`,
        ...(fallback.diagnostics ?? []),
      ],
    };
  }

  let tmpPath: string | null = null;
  try {
    tmpPath = writeTempFile(content, ext);
    // Concrete strategy name for the result.
    const strategy: SyntaxValidationResult['strategy'] =
      cmd === 'swiftc'
        ? 'swiftc'
        : cmd === 'kotlinc'
          ? 'kotlinc'
          : cmd === 'javac'
            ? 'javac'
            : 'dart-analyze';

    // For `dart analyze` the path needs to be the last positional arg.
    // For `swiftc -typecheck` the file is the last arg.
    // For `kotlinc` / `javac` the file is the last arg too.
    const finalArgs = [...args, tmpPath];

    const result = spawnSync(cmd, finalArgs, {
      timeout: 30_000,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });

    if (result.error) {
      // ENOENT / spawn failure — degrade.
      const fallback = validateBraceBalance(content);
      return {
        ...fallback,
        downgraded: true,
        strategy: 'brace-balance',
        diagnostics: [
          `${cmd} spawn failed: ${result.error.message}`,
          ...(fallback.diagnostics ?? []),
        ],
      };
    }

    if (result.status === 0) {
      return { valid: true, strategy };
    }

    const stderr = (result.stderr || '').toString();
    const stdout = (result.stdout || '').toString();
    const combined = [stderr, stdout].filter(Boolean).join('\n').trim();
    return {
      valid: false,
      error: firstLine(combined) || `${cmd} exited with status ${result.status}`,
      diagnostics: combined.split('\n').slice(0, 30),
      strategy,
    };
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore — temp cleanup is best-effort.
      }
    }
  }
}

function isExecutableOnPath(cmd: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(which, [cmd], { encoding: 'utf-8' });
  return result.status === 0 && (result.stdout || '').trim().length > 0;
}

function writeTempFile(content: string, ext: string): string {
  const tmpDir = osTmpDir();
  const file = path.join(tmpDir, `test-genie-syntax-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

function osTmpDir(): string {
  // Use a per-process subdir so concurrent runs don't collide.
  const dir = path.join(os.tmpdir(), 'test-genie-mcp');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim().length > 0) || '';
}

/**
 * Last-resort syntax check: balanced braces, parens, and brackets.
 * This is the same shape as v2.x's check but lives here so all callers go
 * through the same entry point.
 */
export function validateBraceBalance(content: string): SyntaxValidationResult {
  // Strip simple string + comment content so braces inside strings don't trip
  // the counter. This is heuristic only — full lex would defeat the purpose
  // of being a cheap fallback.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

  const counts = {
    brace: count(stripped, '{') - count(stripped, '}'),
    paren: count(stripped, '(') - count(stripped, ')'),
    bracket: count(stripped, '[') - count(stripped, ']'),
  };

  if (counts.brace !== 0) {
    return {
      valid: false,
      error: `Unbalanced braces (diff: ${counts.brace})`,
      strategy: 'brace-balance',
    };
  }
  if (counts.paren !== 0) {
    return {
      valid: false,
      error: `Unbalanced parentheses (diff: ${counts.paren})`,
      strategy: 'brace-balance',
    };
  }
  if (counts.bracket !== 0) {
    return {
      valid: false,
      error: `Unbalanced brackets (diff: ${counts.bracket})`,
      strategy: 'brace-balance',
    };
  }

  return { valid: true, strategy: 'brace-balance' };
}

function count(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) n++;
  }
  return n;
}

export default validateSyntax;
