/**
 * diagnose_project autoFix wiring — v3.1.1.
 *
 * This module is the *honest* implementation of the autoFix parameter that
 * v3.1.0 shipped as a no-op. It only handles subtypes for which we have a
 * concrete, mechanical, low-risk replacement strategy. Everything else is
 * reported as skipped with a reason — never silently dropped.
 *
 * Safety guards (matching SAFETY.md):
 *   - severity floor: only `high` / `critical` findings are eligible
 *   - hard caps: MAX_AUTOFIX_PER_RUN, MAX_FILES_PER_RUN
 *   - path safety: every target file is re-validated against the allowed root
 *   - excluded paths: node_modules/, .git/, dist/, build/
 *   - per-fix flow: backup -> dry-run -> syntax validate -> real apply
 *   - rollback on syntax-validate failure (handled inside applyFix)
 *
 * Strategies in v3.1.1:
 *   - weak-hash:   `createHash('md5'|'sha1')` -> `createHash('sha256')`
 *   - insecure-random: standalone `Math.random()` -> `crypto.randomInt(...)`
 *
 * Everything else (eval, child_process.exec injection, useEffect-no-abort,
 * forEach-await, .env hygiene, yaml.load) is *not* auto-fixed in v3.1.1.
 * The analyzers' `autoFixable` flags were flipped to `false` for those.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FixSuggestion } from '../../types.js';
import { saveFixes } from '../../storage/index.js';
import { confirmFix } from '../fixing/confirmFix.js';
import { applyFix } from '../fixing/applyFix.js';
import { getAllowedRoot, validatePathWithinAllowedRoot } from '../../security.js';
import type { UnifiedFinding, Severity } from './diagnoseProject.js';

/**
 * Hard cap on number of fixes applied per single diagnose_project call.
 * Prevents a runaway diagnosis from rewriting the codebase silently.
 */
export const MAX_AUTOFIX_PER_RUN = 5;

/**
 * Hard cap on distinct files touched per single diagnose_project call.
 */
export const MAX_FILES_PER_RUN = 3;

/**
 * Path segments that are never auto-fixed regardless of allow-root.
 */
const EXCLUDED_SEGMENTS = ['node_modules', '.git', 'dist', 'build'];

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface AppliedFixRecord {
  fixId: string;
  file: string;
  subType: string;
  backupPath?: string;
}

export interface SkippedFixRecord {
  findingId: string;
  subType: string;
  file: string;
  reason: string;
}

export interface AutoFixResult {
  /** Number actually written to disk. */
  applied: number;
  /** Number skipped (cap exceeded, no strategy, excluded path, etc). */
  skipped: number;
  /** Detailed records. */
  appliedFixes: AppliedFixRecord[];
  skippedFixes: SkippedFixRecord[];
  errors: string[];
  /**
   * Caps applied during this run, surfaced so the markdown summary can be
   * honest about why some findings were left.
   */
  caps: {
    maxAutoFixPerRun: number;
    maxFilesPerRun: number;
  };
}

/**
 * True if the path matches an excluded segment we never want to auto-fix.
 */
function isExcluded(filePath: string): boolean {
  // Normalize separators and check segments.
  const segs = filePath.split(path.sep);
  for (const seg of segs) {
    if (EXCLUDED_SEGMENTS.includes(seg)) return true;
  }
  return false;
}

/**
 * Read a finding's target line + N lines of context. Returns null on error.
 */
function readContext(
  filePath: string,
  line: number,
  contextLines = 2,
): { lines: string[]; targetIndex: number; full: string } | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const targetIndex = Math.max(0, Math.min(lines.length - 1, line - 1));
    const start = Math.max(0, targetIndex - contextLines);
    const end = Math.min(lines.length, targetIndex + contextLines + 1);
    return { lines: lines.slice(start, end), targetIndex: targetIndex - start, full: content };
  } catch {
    return null;
  }
}

/**
 * Strategy registry. Each strategy receives the finding and the file content
 * and returns the `{originalCode, suggestedCode, confidence}` triple — or null
 * if the strategy decides this specific occurrence isn't safe to auto-fix.
 */
type Strategy = (
  finding: UnifiedFinding,
  ctx: { lines: string[]; targetIndex: number; full: string },
) => { originalCode: string; suggestedCode: string; confidence: number; description: string } | null;

const STRATEGIES: Record<string, Strategy> = {
  // -----------------------------------------------------------------------
  // securityAnalyzer subType is 'crypto' for both weak-hash and Math.random.
  // We disambiguate by title.
  // -----------------------------------------------------------------------
  crypto: (finding, ctx) => {
    if (/Weak hash algorithm/i.test(finding.title)) {
      return strategyWeakHash(finding, ctx);
    }
    if (/Math\.random/i.test(finding.title)) {
      return strategyInsecureRandom(finding, ctx);
    }
    return null;
  },
};

/**
 * weak-hash strategy: replace `createHash('md5')` / `createHash("sha1")` with
 * `createHash('sha256')` on the reported line. Quote style preserved.
 */
function strategyWeakHash(
  _finding: UnifiedFinding,
  ctx: { lines: string[]; targetIndex: number },
): { originalCode: string; suggestedCode: string; confidence: number; description: string } | null {
  const line = ctx.lines[ctx.targetIndex];
  if (line === undefined) return null;
  const re = /createHash\(\s*(['"])(md5|sha1)\1/;
  const m = line.match(re);
  if (!m) return null;
  const quote = m[1] ?? "'";
  const replaced = line.replace(re, `createHash(${quote}sha256${quote}`);
  if (replaced === line) return null;
  return {
    originalCode: line,
    suggestedCode: replaced,
    confidence: 95,
    description: `Replace weak hash \`${m[2]}\` with \`sha256\` (mechanical string substitution, behavior-preserving for general fingerprinting; for password hashing follow up with bcrypt/scrypt/argon2 separately).`,
  };
}

/**
 * Math.random strategy: replace standalone `Math.random()` with
 * `crypto.randomInt(0, Number.MAX_SAFE_INTEGER) / Number.MAX_SAFE_INTEGER`.
 *
 * Strict guard: only proceed if the matched line ends with `Math.random()`
 * (optionally followed by `;` / `)` / `,`) — i.e. NOT inside arithmetic.
 * We do not attempt to inject the `import { randomInt } from 'crypto'` —
 * the rewrite uses the fully-qualified `crypto.randomInt` so it works in
 * both ESM and CJS files that already `require('crypto')` (which is common
 * in any file that already does cryptography). If the syntax validator
 * rejects the result (unresolved `crypto`), the applyFix rollback path
 * restores from backup.
 */
function strategyInsecureRandom(
  _finding: UnifiedFinding,
  ctx: { lines: string[]; targetIndex: number },
): { originalCode: string; suggestedCode: string; confidence: number; description: string } | null {
  const line = ctx.lines[ctx.targetIndex];
  if (line === undefined) return null;
  // Strict end-of-statement guard. Allows trailing ; , ) but not arithmetic.
  if (!/(?:^|[=,(\s])Math\.random\s*\(\s*\)\s*[);,]?\s*$/.test(line)) return null;
  const replaced = line.replace(
    /Math\.random\s*\(\s*\)/,
    'crypto.randomInt(0, Number.MAX_SAFE_INTEGER) / Number.MAX_SAFE_INTEGER',
  );
  if (replaced === line) return null;
  return {
    originalCode: line,
    suggestedCode: replaced,
    confidence: 75,
    description:
      'Replace `Math.random()` with a CSPRNG-backed expression (`crypto.randomInt`). Assumes `crypto` is in scope (Node built-in; require/import follow-up may be needed).',
  };
}

/**
 * Convert a UnifiedFinding into a FixSuggestion if (and only if) we have a
 * real replacement strategy for its subType + title. Returns null otherwise
 * — never fabricates a placeholder fix.
 */
export function findingToFix(finding: UnifiedFinding): FixSuggestion | null {
  if (!finding.autoFixable) return null;
  const strategy = STRATEGIES[finding.subType];
  if (!strategy) return null;
  const ctx = readContext(finding.file, finding.line, 2);
  if (!ctx) return null;
  const out = strategy(finding, ctx);
  if (!out) return null;
  return {
    id: uuidv4(),
    issueId: finding.id,
    title: `Auto-fix: ${finding.title}`,
    description: out.description,
    confidence: out.confidence,
    file: finding.file,
    line: finding.line,
    originalCode: out.originalCode,
    suggestedCode: out.suggestedCode,
    diff: '',
    impact: {
      filesAffected: [finding.file],
      testsAffected: [],
      riskLevel: 'low',
      breakingChange: false,
      requiresRetest: true,
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Run the autoFix pipeline against the filtered findings list.
 *
 * Steps per fix:
 *   1. enforce severity floor (>= high)
 *   2. enforce path safety (allowed root, excluded segments)
 *   3. enforce hard caps
 *   4. build FixSuggestion via findingToFix(); skip if no strategy
 *   5. save + auto-confirm (action='approve')
 *   6. applyFix({dryRun:true}) -> if dry-run fails, skip (no write)
 *   7. applyFix() -> writes file with backup, validates syntax, rolls back on failure
 */
export function runDiagnoseAutoFix(
  findings: UnifiedFinding[],
  projectPath: string,
): AutoFixResult {
  const allowedRoot = getAllowedRoot();
  const appliedFixes: AppliedFixRecord[] = [];
  const skippedFixes: SkippedFixRecord[] = [];
  const errors: string[] = [];
  const touchedFiles = new Set<string>();

  for (const finding of findings) {
    if (!finding.autoFixable) continue;

    // Severity floor.
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK['high']) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `severity below floor (got ${finding.severity}, need >= high)`,
      });
      continue;
    }

    // Path safety: re-validate against allowed root.
    try {
      validatePathWithinAllowedRoot(finding.file, allowedRoot);
    } catch {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: 'outside TEST_GENIE_ALLOWED_ROOT',
      });
      continue;
    }

    // Excluded segments (node_modules / .git / dist / build).
    if (isExcluded(finding.file)) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: 'excluded path (node_modules/.git/dist/build)',
      });
      continue;
    }

    // Per-run cap.
    if (appliedFixes.length >= MAX_AUTOFIX_PER_RUN) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `cap exceeded (MAX_AUTOFIX_PER_RUN=${MAX_AUTOFIX_PER_RUN})`,
      });
      continue;
    }

    // Per-run file cap (only enforce when adding a new file).
    if (!touchedFiles.has(finding.file) && touchedFiles.size >= MAX_FILES_PER_RUN) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `cap exceeded (MAX_FILES_PER_RUN=${MAX_FILES_PER_RUN})`,
      });
      continue;
    }

    // Build the fix.
    const fix = findingToFix(finding);
    if (!fix) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: 'no auto-fix strategy for this subType/occurrence',
      });
      continue;
    }

    // Persist + auto-confirm.
    saveFixes([fix], projectPath);
    const conf = confirmFix({ fixId: fix.id, action: 'approve', reason: 'diagnose_project autoFix' });
    if (!conf.success) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `confirm failed: ${conf.message}`,
      });
      continue;
    }

    // Dry-run first.
    const dry = applyFix({ fixId: fix.id, backup: true, validate: true, dryRun: true });
    if (!dry.success) {
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `dry-run failed: ${dry.error ?? 'unknown'}`,
      });
      continue;
    }

    // Real apply.
    const real = applyFix({ fixId: fix.id, backup: true, validate: true });
    if (!real.success) {
      errors.push(`apply failed for ${finding.file}: ${real.error ?? 'unknown'}`);
      skippedFixes.push({
        findingId: finding.id,
        subType: finding.subType,
        file: finding.file,
        reason: `apply failed: ${real.error ?? 'unknown'}`,
      });
      continue;
    }

    touchedFiles.add(finding.file);
    appliedFixes.push({
      fixId: fix.id,
      file: finding.file,
      subType: finding.subType,
      backupPath: real.backupPath,
    });
  }

  return {
    applied: appliedFixes.length,
    skipped: skippedFixes.length,
    appliedFixes,
    skippedFixes,
    errors,
    caps: {
      maxAutoFixPerRun: MAX_AUTOFIX_PER_RUN,
      maxFilesPerRun: MAX_FILES_PER_RUN,
    },
  };
}

// Test-only exports.
export const _internal = {
  strategyWeakHash,
  strategyInsecureRandom,
  isExcluded,
  EXCLUDED_SEGMENTS,
};
