/**
 * run_iterative_fix_loop — the v3.0.0 headline tool.
 *
 * A self-healing test → fix → re-test loop with strong safety guards:
 *
 *   1. Collect failing tests (run them if not already).
 *   2. If pass-rate ≥ acceptableThreshold → success, exit.
 *   3. Detect issues (memory + logic), generate fixes via the chosen strategy
 *      (rule-based / llm / hybrid).
 *   4. For each fix: dry-run apply + strong syntax validation. If valid (and
 *      `autoApply: true`) write the file with a backup.
 *   5. Re-run affected tests. If overall pass count went DOWN we treat this
 *      as a regression and auto-rollback the offending fix(es).
 *   6. Repeat until convergence, exhaustion, or stuck.
 *
 * Safety guards (the user's explicit emphasis — "확실하게"):
 *   - `autoApply: false` by default → returns confirm prompts, pauses.
 *   - `maxIterations: 5` cap.
 *   - Per-iteration timeout (`timeoutPerIteration`).
 *   - Per-loop wall-clock timeout (`totalTimeout`).
 *   - Regression detection → automatic rollback.
 *   - All steps persisted to `iteration-logs/{loopId}` for post-hoc analysis.
 *   - Cancellation produces a `resumeToken` so users can pick up later.
 */

import { v4 as uuidv4 } from 'uuid';
import { performance } from 'perf_hooks';

import {
  AppStructure,
  DetectedIssue,
  FixSuggestion,
  Platform,
  TestResult,
} from '../../types.js';
import { analyzeAppStructure } from '../analysis/analyzeAppStructure.js';
import { generateScenarios } from '../analysis/generateScenarios.js';
import { runScenarios, runScenarioTest } from '../execution/runScenarioTest.js';
import { detectMemoryLeaks } from '../detection/detectMemoryLeaks.js';
import { detectLogicErrors } from '../detection/detectLogicErrors.js';
import { suggestFixes } from '../fixing/suggestFixes.js';
import { applyFix, rollbackFix } from '../fixing/applyFix.js';
import { confirmFix } from '../fixing/confirmFix.js';
import { suggestFixWithLlm } from '../fixing/llmFixSuggester.js';
import { isLlmAvailable } from '../../llm/index.js';
import {
  saveIterationLog,
  StoredIterationLog,
  getIterationLog,
} from '../../storage/index.js';

export type Strategy = 'rule-based' | 'llm' | 'hybrid';

export interface IterativeLoopParams {
  projectPath: string;
  /** Optional: failing tests already collected. If absent, will be run first. */
  failingTests?: TestResult[];
  /** Strategy for fix proposal. Default: hybrid. */
  strategy?: Strategy;
  /** Cap on iterations. Default: 5. */
  maxIterations?: number;
  /** Stop early when pass-rate (0-100) reaches this. Default: 100. */
  acceptableThreshold?: number;
  /** Auto-apply approved fixes without confirm pause. Default: false. */
  autoApply?: boolean;
  /** Per-iteration timeout in ms. Default: 5 * 60_000. */
  timeoutPerIteration?: number;
  /** Whole-loop wall-clock timeout in ms. Default: 30 * 60_000. */
  totalTimeout?: number;
  /** Confidence below this triggers LLM fallback in hybrid mode. Default: 80. */
  hybridConfidenceThreshold?: number;
  /** Resume an interrupted loop by id (must match an existing iteration-log). */
  resumeToken?: string;
  /**
   * Test runner override — primarily for tests/CI. When provided, this is
   * called instead of `runScenarios` and is expected to return TestResults.
   */
  testRunner?: (projectPath: string, platform: Platform) => Promise<TestResult[]>;
  /**
   * Issue detector override — also primarily for tests. When provided, used
   * instead of running the static detectors.
   */
  issueDetector?: (appStructure: AppStructure) => DetectedIssue[];
  /** Optional progress callback. */
  onProgress?: (phase: string, message: string, iteration: number) => void;
}

export interface IterationLog {
  n: number;
  failingCount: number;
  fixesApplied: number;
  regressionsRolledBack: number;
  passedAfter: number;
  failedAfter: number;
  durationMs: number;
  notes?: string;
  appliedFixIds: string[];
  rolledBackFixIds: string[];
}

export interface IterativeLoopResult {
  loopId: string;
  status: 'success' | 'exhausted' | 'stuck' | 'cancelled' | 'error' | 'paused-for-confirmation';
  iterations: IterationLog[];
  finalTestState: { passed: number; failed: number; total: number };
  appliedFixes: string[];
  rolledBackFixes: string[];
  pendingConfirmations?: FixSuggestion[];
  resumeToken?: string;
  /** Human-readable multi-line summary. */
  summary: string;
  /** Set when status is 'error'. */
  error?: string;
}

const DEFAULTS = {
  strategy: 'hybrid' as Strategy,
  maxIterations: 5,
  acceptableThreshold: 100,
  autoApply: false,
  timeoutPerIteration: 5 * 60_000,
  totalTimeout: 30 * 60_000,
  hybridConfidenceThreshold: 80,
};

export async function runIterativeFixLoop(
  params: IterativeLoopParams,
): Promise<IterativeLoopResult> {
  const cfg = { ...DEFAULTS, ...params };
  const loopId = params.resumeToken || uuidv4();
  const startedAt = new Date().toISOString();
  const loopStart = performance.now();

  // Initialize / restore log
  let storedLog: StoredIterationLog;
  if (params.resumeToken) {
    const prior = getIterationLog(params.resumeToken);
    if (!prior) {
      return makeErrorResult(loopId, `Unknown resumeToken: ${params.resumeToken}`);
    }
    storedLog = { ...prior, status: 'running', updatedAt: new Date().toISOString() };
  } else {
    storedLog = {
      loopId,
      projectPath: params.projectPath,
      status: 'running',
      iterations: [],
      appliedFixIds: [],
      rolledBackFixIds: [],
      startedAt,
      updatedAt: startedAt,
      config: {
        strategy: cfg.strategy,
        maxIterations: cfg.maxIterations,
        acceptableThreshold: cfg.acceptableThreshold,
        autoApply: cfg.autoApply,
      },
    };
  }
  saveIterationLog(storedLog);

  const progress = (phase: string, message: string, iteration: number) => {
    params.onProgress?.(phase, message, iteration);
  };

  // Resolve project context
  let appStructure: AppStructure;
  try {
    appStructure = analyzeAppStructure({ projectPath: params.projectPath, depth: 'normal' });
  } catch (err) {
    storedLog.status = 'error';
    storedLog.updatedAt = new Date().toISOString();
    saveIterationLog(storedLog);
    return makeErrorResult(loopId, `App analysis failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const runTests = async (): Promise<TestResult[]> => {
    if (params.testRunner) {
      return params.testRunner(params.projectPath, appStructure.platform);
    }
    // Auto-generate a minimal set of scenarios then run them. We deliberately
    // keep the set small (one pass through generation, not full automation)
    // because the iterate loop is about fix → re-test convergence, not initial
    // discovery.
    const { scenarios } = generateScenarios({
      appStructure,
      testTypes: ['unit', 'integration', 'e2e'],
      coverage: 'minimal',
      maxScenarios: 10,
    });
    if (scenarios.length === 0) return [];
    const { results } = await runScenarios(
      scenarios,
      params.projectPath,
      appStructure.platform,
      { parallel: false, maxParallel: 2 },
    );
    return results;
  };

  const detectIssues = (): DetectedIssue[] => {
    if (params.issueDetector) {
      return params.issueDetector(appStructure);
    }
    const memory = detectMemoryLeaks({ appStructure, analysisType: 'static' }).issues;
    const logic = detectLogicErrors({ appStructure, analysisDepth: 'normal' }).issues;
    return [...memory, ...logic];
  };

  // Establish initial test state
  let currentTests: TestResult[] = params.failingTests
    ? params.failingTests
    : await runTests();
  let lastFailingCount = currentTests.filter((t) => t.status === 'failed' || t.status === 'error').length;
  let lastPassingCount = currentTests.filter((t) => t.status === 'passed').length;

  progress('start', `Initial: ${lastPassingCount} pass / ${lastFailingCount} fail`, 0);

  const pendingConfirmations: FixSuggestion[] = [];
  const allAppliedFixIds: string[] = [...storedLog.appliedFixIds];
  const allRolledBackFixIds: string[] = [...storedLog.rolledBackFixIds];

  for (let n = 1; n <= cfg.maxIterations; n++) {
    const iterStart = performance.now();

    // Wall-clock guard
    if (performance.now() - loopStart > cfg.totalTimeout) {
      storedLog.status = 'cancelled';
      storedLog.updatedAt = new Date().toISOString();
      storedLog.resumeToken = loopId;
      saveIterationLog(storedLog);
      return finalize(loopId, 'cancelled', storedLog.iterations.map(toLog), {
        passed: lastPassingCount,
        failed: lastFailingCount,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations, loopId);
    }

    progress('iterate', `Iteration ${n} starting (failing=${lastFailingCount})`, n);

    const passRate = currentTests.length === 0
      ? 100
      : (lastPassingCount / currentTests.length) * 100;
    if (passRate >= cfg.acceptableThreshold) {
      progress('done', `Threshold reached at iteration ${n - 1} (${passRate.toFixed(1)}%)`, n - 1);
      storedLog.status = 'success';
      storedLog.completedAt = new Date().toISOString();
      storedLog.updatedAt = storedLog.completedAt;
      saveIterationLog(storedLog);
      return finalize(loopId, 'success', storedLog.iterations.map(toLog), {
        passed: lastPassingCount,
        failed: lastFailingCount,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
    }

    // Detect issues
    const issues = detectIssues();
    if (issues.length === 0) {
      // Nothing else to try. If still failing, mark stuck.
      const note = 'No issues detected by analyzers — no fixes to attempt';
      storedLog.iterations.push({
        n,
        failingCount: lastFailingCount,
        fixesApplied: 0,
        regressionsRolledBack: 0,
        passedAfter: lastPassingCount,
        failedAfter: lastFailingCount,
        durationMs: performance.now() - iterStart,
        notes: note,
      });
      storedLog.status = 'stuck';
      storedLog.completedAt = new Date().toISOString();
      storedLog.updatedAt = storedLog.completedAt;
      saveIterationLog(storedLog);
      return finalize(loopId, 'stuck', storedLog.iterations.map(toLog), {
        passed: lastPassingCount,
        failed: lastFailingCount,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
    }

    // Generate candidate fixes
    const { suggestions: ruleSuggestions } = suggestFixes({
      issues,
      projectPath: params.projectPath,
      platform: appStructure.platform,
      maxSuggestions: 20,
    });

    let candidates: FixSuggestion[] = [...ruleSuggestions];

    // Hybrid / LLM strategy: promote LLM fixes when rule confidence too low
    if ((cfg.strategy === 'hybrid' || cfg.strategy === 'llm') && isLlmAvailable()) {
      // For each issue lacking a confident rule-based fix, ask LLM.
      const ruleByIssue = new Map<string, FixSuggestion | undefined>();
      ruleSuggestions.forEach((s) => ruleByIssue.set(s.issueId, s));

      for (const issue of issues.slice(0, 5)) {
        const ruleFix = ruleByIssue.get(issue.id);
        const shouldAskLlm =
          cfg.strategy === 'llm' ||
          !ruleFix ||
          ruleFix.confidence < cfg.hybridConfidenceThreshold;
        if (!shouldAskLlm) continue;

        const reason = ruleFix
          ? `rule-based confidence ${ruleFix.confidence} below threshold ${cfg.hybridConfidenceThreshold}`
          : 'no rule-based fix matched';
        const llmResult = await suggestFixWithLlm({
          issue,
          platform: appStructure.platform,
          projectPath: params.projectPath,
          reason,
        });
        if (llmResult.status === 'ok' && llmResult.suggestion) {
          candidates.push(llmResult.suggestion);
        }
      }
    }

    if (candidates.length === 0) {
      const note = 'No fix candidates generated';
      storedLog.iterations.push({
        n,
        failingCount: lastFailingCount,
        fixesApplied: 0,
        regressionsRolledBack: 0,
        passedAfter: lastPassingCount,
        failedAfter: lastFailingCount,
        durationMs: performance.now() - iterStart,
        notes: note,
      });
      storedLog.status = 'stuck';
      storedLog.completedAt = new Date().toISOString();
      storedLog.updatedAt = storedLog.completedAt;
      saveIterationLog(storedLog);
      return finalize(loopId, 'stuck', storedLog.iterations.map(toLog), {
        passed: lastPassingCount,
        failed: lastFailingCount,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
    }

    // If !autoApply, return immediately with the candidates for the caller to
    // confirm. Persist state so caller can resume.
    if (!cfg.autoApply) {
      pendingConfirmations.push(...candidates);
      storedLog.iterations.push({
        n,
        failingCount: lastFailingCount,
        fixesApplied: 0,
        regressionsRolledBack: 0,
        passedAfter: lastPassingCount,
        failedAfter: lastFailingCount,
        durationMs: performance.now() - iterStart,
        notes: `paused for confirmation (${candidates.length} candidates)`,
      });
      storedLog.status = 'cancelled';
      storedLog.resumeToken = loopId;
      storedLog.updatedAt = new Date().toISOString();
      saveIterationLog(storedLog);
      return finalize(loopId, 'paused-for-confirmation', storedLog.iterations.map(toLog), {
        passed: lastPassingCount,
        failed: lastFailingCount,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations, loopId);
    }

    // Apply phase
    let fixesApplied = 0;
    let regressionsRolledBack = 0;
    const justApplied: string[] = [];

    const beforePassing = lastPassingCount;
    const beforeFailing = lastFailingCount;

    for (const fix of candidates.slice(0, 5)) {
      // Dry-run first → validates syntax via applyFix's strong validator
      const dry = applyFix({ fixId: fix.id, backup: true, validate: true, dryRun: true });
      if (!dry.success) {
        continue;
      }
      confirmFix({ fixId: fix.id, action: 'approve' });
      const applied = applyFix({ fixId: fix.id, backup: true, validate: true });
      if (applied.success) {
        fixesApplied++;
        justApplied.push(fix.id);
        allAppliedFixIds.push(fix.id);
      }
    }

    // Re-test (timed)
    let afterTests: TestResult[];
    try {
      afterTests = await Promise.race([
        runTests(),
        new Promise<TestResult[]>((_, reject) =>
          setTimeout(() => reject(new Error('iteration timeout')), cfg.timeoutPerIteration),
        ),
      ]);
    } catch (err) {
      // Iteration timed out — rollback this iteration's fixes and mark cancelled.
      for (const fid of justApplied) {
        rollbackFix(fid);
        regressionsRolledBack++;
        allRolledBackFixIds.push(fid);
      }
      storedLog.iterations.push({
        n,
        failingCount: beforeFailing,
        fixesApplied,
        regressionsRolledBack,
        passedAfter: beforePassing,
        failedAfter: beforeFailing,
        durationMs: performance.now() - iterStart,
        notes: `iteration timeout — rolled back ${justApplied.length} fixes`,
      });
      storedLog.status = 'cancelled';
      storedLog.resumeToken = loopId;
      storedLog.updatedAt = new Date().toISOString();
      saveIterationLog(storedLog);
      return finalize(loopId, 'cancelled', storedLog.iterations.map(toLog), {
        passed: beforePassing,
        failed: beforeFailing,
        total: currentTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations, loopId);
    }

    const afterPassing = afterTests.filter((t) => t.status === 'passed').length;
    const afterFailing = afterTests.filter((t) => t.status === 'failed' || t.status === 'error').length;

    // Regression check — if passing count went DOWN, roll back this iteration.
    if (afterPassing < beforePassing) {
      for (const fid of justApplied) {
        rollbackFix(fid);
        regressionsRolledBack++;
        allRolledBackFixIds.push(fid);
      }
      // Restore counts to pre-iteration.
      lastPassingCount = beforePassing;
      lastFailingCount = beforeFailing;
      storedLog.iterations.push({
        n,
        failingCount: beforeFailing,
        fixesApplied,
        regressionsRolledBack,
        passedAfter: beforePassing,
        failedAfter: beforeFailing,
        durationMs: performance.now() - iterStart,
        notes: `regression detected (pass ${beforePassing}→${afterPassing}) — auto-rollback`,
      });
      // If regression and we have no further alternative strategy, we are stuck.
      if (n === cfg.maxIterations) {
        storedLog.status = 'stuck';
        storedLog.completedAt = new Date().toISOString();
        storedLog.updatedAt = storedLog.completedAt;
        saveIterationLog(storedLog);
        return finalize(loopId, 'stuck', storedLog.iterations.map(toLog), {
          passed: beforePassing,
          failed: beforeFailing,
          total: currentTests.length,
        }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
      }
      continue;
    }

    // Progress made (or stalemate)
    currentTests = afterTests;
    lastPassingCount = afterPassing;
    lastFailingCount = afterFailing;

    storedLog.iterations.push({
      n,
      failingCount: beforeFailing,
      fixesApplied,
      regressionsRolledBack,
      passedAfter: afterPassing,
      failedAfter: afterFailing,
      durationMs: performance.now() - iterStart,
    });
    storedLog.appliedFixIds = allAppliedFixIds;
    storedLog.rolledBackFixIds = allRolledBackFixIds;
    storedLog.updatedAt = new Date().toISOString();
    saveIterationLog(storedLog);

    // Convergence check
    const newPassRate = afterTests.length === 0 ? 100 : (afterPassing / afterTests.length) * 100;
    if (newPassRate >= cfg.acceptableThreshold) {
      storedLog.status = 'success';
      storedLog.completedAt = new Date().toISOString();
      storedLog.updatedAt = storedLog.completedAt;
      saveIterationLog(storedLog);
      return finalize(loopId, 'success', storedLog.iterations.map(toLog), {
        passed: afterPassing,
        failed: afterFailing,
        total: afterTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
    }

    // No improvement at all → stuck
    if (afterPassing === beforePassing && fixesApplied > 0) {
      storedLog.status = 'stuck';
      storedLog.completedAt = new Date().toISOString();
      storedLog.updatedAt = storedLog.completedAt;
      saveIterationLog(storedLog);
      return finalize(loopId, 'stuck', storedLog.iterations.map(toLog), {
        passed: afterPassing,
        failed: afterFailing,
        total: afterTests.length,
      }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
    }
  }

  // Ran out of iterations
  storedLog.status = 'exhausted';
  storedLog.completedAt = new Date().toISOString();
  storedLog.updatedAt = storedLog.completedAt;
  saveIterationLog(storedLog);
  return finalize(loopId, 'exhausted', storedLog.iterations.map(toLog), {
    passed: lastPassingCount,
    failed: lastFailingCount,
    total: currentTests.length,
  }, allAppliedFixIds, allRolledBackFixIds, pendingConfirmations);
}

function toLog(entry: StoredIterationLog['iterations'][number]): IterationLog {
  return {
    n: entry.n,
    failingCount: entry.failingCount,
    fixesApplied: entry.fixesApplied,
    regressionsRolledBack: entry.regressionsRolledBack,
    passedAfter: entry.passedAfter,
    failedAfter: entry.failedAfter,
    durationMs: entry.durationMs,
    notes: entry.notes,
    appliedFixIds: [],
    rolledBackFixIds: [],
  };
}

function finalize(
  loopId: string,
  status: IterativeLoopResult['status'],
  iterations: IterationLog[],
  finalTestState: IterativeLoopResult['finalTestState'],
  appliedFixes: string[],
  rolledBackFixes: string[],
  pendingConfirmations: FixSuggestion[],
  resumeToken?: string,
): IterativeLoopResult {
  return {
    loopId,
    status,
    iterations,
    finalTestState,
    appliedFixes,
    rolledBackFixes,
    pendingConfirmations: pendingConfirmations.length > 0 ? pendingConfirmations : undefined,
    resumeToken,
    summary: buildSummary(loopId, status, iterations, finalTestState, appliedFixes, rolledBackFixes),
  };
}

function makeErrorResult(loopId: string, error: string): IterativeLoopResult {
  return {
    loopId,
    status: 'error',
    iterations: [],
    finalTestState: { passed: 0, failed: 0, total: 0 },
    appliedFixes: [],
    rolledBackFixes: [],
    summary: `Iterative fix loop ${loopId} errored: ${error}`,
    error,
  };
}

function buildSummary(
  loopId: string,
  status: string,
  iterations: IterationLog[],
  finalState: IterativeLoopResult['finalTestState'],
  applied: string[],
  rolledBack: string[],
): string {
  const lines: string[] = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Iterative fix loop ${loopId} — ${status.toUpperCase()}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`Iterations completed: ${iterations.length}`);
  lines.push(`Fixes applied:        ${applied.length}`);
  lines.push(`Regressions rolled back: ${rolledBack.length}`);
  lines.push(`Final tests:          ${finalState.passed}/${finalState.total} passing (${finalState.failed} failing)`);
  if (iterations.length > 0) {
    lines.push('');
    lines.push('Per-iteration:');
    for (const it of iterations) {
      const note = it.notes ? ` — ${it.notes}` : '';
      lines.push(`  #${it.n}: ${it.passedAfter} pass, ${it.failedAfter} fail, ${it.fixesApplied} fixes, ${it.regressionsRolledBack} rollback${note}`);
    }
  }
  return lines.join('\n');
}

export default runIterativeFixLoop;
