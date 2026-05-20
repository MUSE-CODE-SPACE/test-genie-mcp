/**
 * diagnose_project — the v3.1.0 vibe-check headline tool.
 *
 * One call: detect race conditions + security issues + memory leaks + logic
 * errors + performance smells, in parallel, with per-check timeouts. Returns
 * a small structured report plus a Markdown summary ready for Claude to
 * paste in the chat.
 *
 * The vibe-coder use case: "open the project, ask Claude what's broken,
 * read 20 lines, fix the top thing." Everything here is shaped to make that
 * single turn feel instant and actionable.
 */
import * as path from 'path';
import { Platform } from '../../types.js';
import { analyzeAppStructure } from '../analysis/analyzeAppStructure.js';
import { analyzeRaceConditions, RaceFinding } from '../../analyzers/raceConditionAnalyzer.js';
import { analyzeSecurity, SecurityFinding } from '../../analyzers/securityAnalyzer.js';
import { detectMemoryLeaks } from '../detection/detectMemoryLeaks.js';
import { detectLogicErrors } from '../detection/detectLogicErrors.js';
import { analyzePerformance } from '../../analyzers/performanceAnalyzer.js';
import { runDiagnoseAutoFix, AutoFixResult } from './diagnoseAutoFix.js';

export type Check = 'race-conditions' | 'security' | 'memory-leaks' | 'logic-errors' | 'performance';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
const SEVERITY_ORDER: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface UnifiedFinding {
  id: string;
  category: string;
  subType: string;
  severity: Severity;
  confidence?: number;
  file: string;
  line: number;
  title: string;
  description?: string;
  snippet?: string;
  recommendation?: string;
  autoFixable?: boolean;
  fixId?: string;
  cwe?: string;
}

export interface DiagnoseProjectParams {
  projectPath: string;
  platforms?: Platform[];
  checks?: Check[];
  severityThreshold?: Severity;
  output?: 'summary' | 'detailed' | 'json';
  autoFix?: boolean;
  /** Per-check timeout (ms) — defaults to 60s. */
  perCheckTimeoutMs?: number;
}

export interface DiagnoseProjectResult {
  projectInfo: {
    path: string;
    platform: Platform;
    fileCount: number;
    framework?: string;
  };
  findings: UnifiedFinding[];
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byCategory: Record<string, number>;
    estimatedFixTimeMinutes: number;
  };
  topFindings: UnifiedFinding[];
  checksRun: Check[];
  checksTimedOut: Check[];
  suggestedNextCommands: string[];
  markdownSummary: string;
  /**
   * Present only when `autoFix: true` was passed. Reports what was
   * actually applied / skipped / errored. See diagnoseAutoFix.ts.
   */
  autoFixResult?: AutoFixResult;
}

const DEFAULT_CHECKS: Check[] = ['race-conditions', 'security', 'memory-leaks', 'logic-errors', 'performance'];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<{ ok: true; value: T } | { ok: false; label: string }> {
  // ms <= 0 means "consider already timed out" — useful for tests and for
  // a "skip slow checks" power-user flag.
  if (ms <= 0) {
    return Promise.resolve({ ok: false, label });
  }
  return new Promise((resolve) => {
    let resolved = false;
    const t = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, label });
      }
    }, ms);
    p.then(
      (value) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(t);
          resolve({ ok: true, value });
        }
      },
      () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(t);
          resolve({ ok: false, label });
        }
      },
    );
  });
}

function asUnified(f: RaceFinding | SecurityFinding): UnifiedFinding {
  return {
    id: f.id,
    category: f.category,
    subType: f.subType,
    severity: f.severity as Severity,
    confidence: f.confidence,
    file: f.file,
    line: f.line,
    title: f.title,
    description: f.description,
    snippet: f.snippet,
    recommendation: f.recommendation,
    autoFixable: f.autoFixable,
    cwe: f.cwe,
  };
}

function estimateFixMinutes(f: UnifiedFinding): number {
  // Rough heuristic — autoFixable / high-confidence ~5min, others ~30min.
  if (f.autoFixable && (f.confidence ?? 0) >= 70) return 5;
  if (f.severity === 'critical') return 30;
  if (f.severity === 'high') return 20;
  if (f.severity === 'medium') return 15;
  return 10;
}

function severityIcon(s: Severity): string {
  switch (s) {
    case 'critical':
      return '[CRIT]';
    case 'high':
      return '[HIGH]';
    case 'medium':
      return '[MED]';
    case 'low':
      return '[LOW]';
  }
}

function rank(a: UnifiedFinding, b: UnifiedFinding): number {
  const sd = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  if (sd !== 0) return sd;
  return (b.confidence ?? 0) - (a.confidence ?? 0);
}

export async function diagnoseProject(params: DiagnoseProjectParams): Promise<DiagnoseProjectResult> {
  const projectPath = path.resolve(params.projectPath);
  const checks = params.checks ?? DEFAULT_CHECKS;
  const output = params.output ?? 'summary';
  const threshold = params.severityThreshold ?? 'low';
  const perTimeout = params.perCheckTimeoutMs ?? 60_000;

  // Detect platform + structure once.
  const appStructure = analyzeAppStructure({ projectPath });
  const platform: Platform = (params.platforms?.[0] as Platform | undefined) ?? appStructure.platform;
  const fileCount = appStructure.components.length + appStructure.screens.length;

  const tasks: Array<{ check: Check; run: () => Promise<UnifiedFinding[]> }> = [];

  if (checks.includes('race-conditions')) {
    tasks.push({
      check: 'race-conditions',
      run: async () => analyzeRaceConditions(projectPath, platform).findings.map(asUnified),
    });
  }
  if (checks.includes('security')) {
    tasks.push({
      check: 'security',
      run: async () => analyzeSecurity(projectPath, platform).findings.map(asUnified),
    });
  }
  if (checks.includes('memory-leaks')) {
    tasks.push({
      check: 'memory-leaks',
      run: async () => {
        const r = detectMemoryLeaks({ appStructure, analysisType: 'static' });
        return r.issues.map((i) => ({
          id: i.id,
          category: 'memory-leak',
          subType: i.type,
          severity: (i.severity === 'info' ? 'low' : i.severity) as Severity,
          confidence: 75,
          file: i.file,
          line: i.line,
          title: i.title,
          description: i.description,
          snippet: i.code,
          recommendation: i.suggestion,
          autoFixable: false,
        }));
      },
    });
  }
  if (checks.includes('logic-errors')) {
    tasks.push({
      check: 'logic-errors',
      run: async () => {
        const r = detectLogicErrors({ appStructure });
        return r.issues.map((i) => ({
          id: i.id,
          category: 'logic-error',
          subType: i.type,
          severity: (i.severity === 'info' ? 'low' : i.severity) as Severity,
          confidence: 70,
          file: i.file,
          line: i.line,
          title: i.title,
          description: i.description,
          snippet: i.code,
          recommendation: i.suggestion,
          autoFixable: false,
        }));
      },
    });
  }
  if (checks.includes('performance')) {
    tasks.push({
      check: 'performance',
      run: async () => {
        try {
          const r = await analyzePerformance(projectPath, platform);
          // Surface only critical + major; minor would drown the summary.
          const items: UnifiedFinding[] = [];
          for (const rec of r.recommendations.slice(0, 3)) {
            items.push({
              id: `perf-${items.length}`,
              category: 'performance',
              subType: rec.category,
              severity: (rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low') as Severity,
              confidence: 60,
              file: projectPath,
              line: 1,
              title: `Performance: ${rec.category}`,
              description: rec.description,
              recommendation: rec.estimatedImpact,
              autoFixable: false,
            });
          }
          return items;
        } catch {
          return [];
        }
      },
    });
  }

  const results = await Promise.all(tasks.map((t) => withTimeout(t.run(), perTimeout, t.check)));

  const findings: UnifiedFinding[] = [];
  const checksTimedOut: Check[] = [];
  const checksRun: Check[] = [];

  results.forEach((r, idx) => {
    const task = tasks[idx];
    if (!task) return;
    checksRun.push(task.check);
    if (r.ok) {
      findings.push(...r.value);
    } else {
      checksTimedOut.push(task.check);
    }
  });

  // Filter by severity threshold.
  const minScore = SEVERITY_ORDER[threshold];
  const filtered = findings.filter((f) => SEVERITY_ORDER[f.severity] >= minScore);

  // Stable sort high → low.
  filtered.sort(rank);

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory: Record<string, number> = {};
  let estimated = 0;
  for (const f of filtered) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    estimated += estimateFixMinutes(f);
  }

  const topFindings = filtered.slice(0, 5);

  // ----------------------------------------------------------------------
  // autoFix wiring (v3.1.1 — real, not a no-op).
  //
  // Only runs when autoFix:true is explicitly passed. Operates on the
  // already-filtered findings list. See diagnoseAutoFix.ts for the
  // safety guards (severity floor, hard caps, excluded paths, etc.).
  // ----------------------------------------------------------------------
  let autoFixResult: AutoFixResult | undefined;
  if (params.autoFix === true) {
    autoFixResult = runDiagnoseAutoFix(filtered, projectPath);
  }

  // Honest signal: a fix has a real strategy only if its analyzer flagged
  // it AND we have an implementation. We don't promise things we can't do.
  const hasRealAutoFixCandidate = filtered.some(
    (f) =>
      f.autoFixable === true &&
      (SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER['high']) &&
      // Currently implemented strategies — keep in sync with diagnoseAutoFix.ts.
      (f.subType === 'crypto'),
  );

  const suggestedNext: string[] = [];
  if (!autoFixResult && hasRealAutoFixCandidate) {
    suggestedNext.push(
      'Run `diagnose_project` with `autoFix: true` to apply the safe mechanical fixes (weak-hash + simple Math.random). Backups are written to `.test-genie-backups/`.',
    );
  }
  if (filtered.length > 5) {
    suggestedNext.push('Use `output: "detailed"` to see the full finding list');
  }
  if (bySeverity.critical > 0) {
    suggestedNext.push('Address critical findings first — they are the highest-impact items in the list');
  }
  suggestedNext.push('Re-run `diagnose_project` after applying fixes to confirm convergence');

  const markdownSummary = buildMarkdownSummary({
    projectPath,
    platform,
    bySeverity,
    byCategory,
    topFindings,
    estimated,
    checksRun,
    checksTimedOut,
    totalFindings: filtered.length,
    output,
    autoFixResult,
    hasRealAutoFixCandidate,
  });

  return {
    projectInfo: {
      path: projectPath,
      platform,
      fileCount,
      framework: appStructure.stateManagement?.type,
    },
    findings: output === 'summary' ? topFindings : filtered,
    summary: { total: filtered.length, bySeverity, byCategory, estimatedFixTimeMinutes: estimated },
    topFindings,
    checksRun,
    checksTimedOut,
    suggestedNextCommands: suggestedNext,
    markdownSummary,
    autoFixResult,
  };
}

function buildMarkdownSummary(args: {
  projectPath: string;
  platform: Platform;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  topFindings: UnifiedFinding[];
  estimated: number;
  checksRun: Check[];
  checksTimedOut: Check[];
  totalFindings: number;
  output: 'summary' | 'detailed' | 'json';
  autoFixResult?: AutoFixResult;
  hasRealAutoFixCandidate: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`# vibe-check report`);
  lines.push('');
  lines.push(`- **Project:** ${args.projectPath}`);
  lines.push(`- **Platform:** ${args.platform}`);
  lines.push(
    `- **Findings:** ${args.totalFindings} total — ` +
      `${args.bySeverity.critical} critical, ${args.bySeverity.high} high, ${args.bySeverity.medium} medium, ${args.bySeverity.low} low`,
  );
  lines.push(`- **Estimated fix time:** ~${args.estimated} min`);
  if (args.checksTimedOut.length > 0) {
    lines.push(`- **Checks timed out:** ${args.checksTimedOut.join(', ')}`);
  }
  lines.push('');

  // Honest autoFix block — only printed when autoFix actually ran.
  if (args.autoFixResult) {
    const r = args.autoFixResult;
    lines.push(`## Auto-fix result`);
    lines.push('');
    lines.push(
      `- **Applied ${r.applied} fixes** (backups at \`.test-genie-backups/\` next to each modified file).`,
    );
    lines.push(`- Skipped ${r.skipped} fix(es). Failed ${r.errors.length}.`);
    lines.push(
      `- Caps in effect: max ${r.caps.maxAutoFixPerRun} fixes / max ${r.caps.maxFilesPerRun} files per call.`,
    );
    lines.push(
      `- Severity floor: only \`high\`+\`critical\` findings with an implemented strategy are auto-applied. No tests are re-run by this path (use \`run_iterative_fix_loop\` for that).`,
    );
    if (r.appliedFixes.length > 0) {
      lines.push('');
      lines.push(`Applied:`);
      for (const af of r.appliedFixes) {
        lines.push(`- \`${path.relative(args.projectPath, af.file)}\` — ${af.subType}`);
      }
    }
    if (r.skippedFixes.length > 0) {
      lines.push('');
      lines.push(`Skipped:`);
      for (const sf of r.skippedFixes) {
        lines.push(`- \`${path.relative(args.projectPath, sf.file)}\` — ${sf.subType} (${sf.reason})`);
      }
    }
    lines.push('');
  }

  if (args.topFindings.length === 0) {
    lines.push(`No findings above threshold. Project looks clean from a vibe-check standpoint.`);
    return lines.join('\n');
  }

  lines.push(`## Top ${args.topFindings.length} issues`);
  lines.push('');
  args.topFindings.forEach((f, i) => {
    lines.push(`### ${i + 1}. ${severityIcon(f.severity)} ${f.title}`);
    lines.push(`- **File:** \`${path.relative(args.projectPath, f.file)}:${f.line}\``);
    lines.push(`- **Category:** ${f.category} / ${f.subType}${f.cwe ? ` (${f.cwe})` : ''}`);
    if (f.confidence !== undefined) {
      lines.push(`- **Confidence:** ${f.confidence}%`);
    }
    if (f.snippet) {
      lines.push(`- **Snippet:** \`${f.snippet}\``);
    }
    if (f.recommendation) {
      lines.push(`- **Fix:** ${f.recommendation}`);
    }
    // Only mention auto-fix when (a) the analyzer flagged it and (b) we
    // have a real strategy that would be invoked at severity>=high. Never
    // advertise capability we don't have.
    if (
      f.autoFixable &&
      SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER['high'] &&
      f.subType === 'crypto'
    ) {
      lines.push(`- **Auto-fixable:** yes — pass \`autoFix: true\` to apply (backup + syntax-validate, no test re-run).`);
    }
    lines.push('');
  });

  lines.push(`## Next steps`);
  lines.push('');
  lines.push(`1. Address the critical / high findings above.`);
  lines.push(`2. Re-run \`diagnose_project\` after fixing to confirm convergence.`);
  lines.push(`3. Use \`run_iterative_fix_loop\` if you want test-driven verification of each fix (this path re-runs tests + rolls back on regression).`);
  if (args.hasRealAutoFixCandidate && !args.autoFixResult) {
    lines.push(`4. For the safe mechanical fixes (weak-hash, simple \`Math.random\` assignment), \`autoFix: true\` will apply them with backup + syntax validation. Other patterns are report-only.`);
  }

  return lines.join('\n');
}
