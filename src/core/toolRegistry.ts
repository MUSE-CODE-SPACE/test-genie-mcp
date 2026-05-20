/**
 * Shared tool registry — single source of truth for the 20 test-genie tools.
 *
 * Replaces the giant `switch (name)` in v2.x `src/index.ts`. Each entry
 * carries a JSON-schema descriptor (for `tools/list`), a Zod schema for input
 * validation (also passed to `McpServer.registerTool`), and a handler that
 * receives validated args.
 *
 * Why a separate file: both entry points (stdio + future HTTP) can import the
 * same registry and stay in lock-step. Adding a tool is a single-line edit.
 */

import { z } from 'zod';

import { analyzeAppStructure } from '../tools/analysis/analyzeAppStructure.js';
import { generateScenarios } from '../tools/analysis/generateScenarios.js';
import { createTestPlan, createQuickPlan } from '../tools/analysis/createTestPlan.js';
import { runScenarioTest } from '../tools/execution/runScenarioTest.js';
import { runSimulation } from '../tools/execution/runSimulation.js';
import { runStressTest } from '../tools/execution/runStressTest.js';
import { detectMemoryLeaks } from '../tools/detection/detectMemoryLeaks.js';
import { detectLogicErrors } from '../tools/detection/detectLogicErrors.js';
import { suggestFixes } from '../tools/fixing/suggestFixes.js';
import { confirmFix, generateConfirmationPrompt } from '../tools/fixing/confirmFix.js';
import { applyFix, rollbackFix } from '../tools/fixing/applyFix.js';
import { runFullAutomation } from '../tools/automation/runFullAutomation.js';
import { runIterativeFixLoop } from '../tools/automation/runIterativeFixLoop.js';
import { generateReport } from '../tools/automation/generateReport.js';
import { generateCICDConfig, writeCICDConfig } from '../tools/automation/cicdIntegration.js';
import { analyzePerformance } from '../analyzers/performanceAnalyzer.js';
import { analyzeProject } from '../analyzers/astAnalyzer.js';

import * as storage from '../storage/index.js';
import { validatePathWithinAllowedRoot, ToolError } from '../security.js';

export type ZodShape = Record<string, z.ZodTypeAny>;

export interface RegisteredTool {
  name: string;
  description: string;
  /** Zod raw shape — McpServer's registerTool expects this form. */
  inputShape: ZodShape;
  /** Validated-input handler. */
  handler: (args: any) => Promise<{ text: string; isError?: boolean }> | { text: string; isError?: boolean };
}

const PlatformEnum = z.enum(['ios', 'android', 'flutter', 'react-native', 'web']);
const TestTypeEnum = z.enum(['unit', 'integration', 'e2e', 'performance', 'stress', 'memory']);

function safePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ToolError('projectPath is required', 'VALIDATION_ERROR');
  }
  return validatePathWithinAllowedRoot(input);
}

function json(value: unknown): { text: string } {
  return { text: JSON.stringify(value, null, 2) };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const analyzeAppStructureTool: RegisteredTool = {
  name: 'analyze_app_structure',
  description:
    '[mode: real] Static analysis of the project: screens, components, APIs, state. Auto-detects platform when not provided.',
  inputShape: {
    projectPath: z.string(),
    platform: PlatformEnum.optional(),
    depth: z.enum(['shallow', 'normal', 'deep']).optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const result = analyzeAppStructure({
      projectPath,
      platform: args.platform,
      depth: args.depth,
    });
    return json(result);
  },
};

const generateScenariosTool: RegisteredTool = {
  name: 'generate_scenarios',
  description: '[mode: real] Generate test scenarios from analyzed app structure.',
  inputShape: {
    projectPath: z.string(),
    testTypes: z.array(TestTypeEnum).optional(),
    coverage: z.enum(['minimal', 'standard', 'comprehensive']).optional(),
    focusAreas: z.array(z.string()).optional(),
    maxScenarios: z.number().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const result = generateScenarios({
      appStructure,
      testTypes: args.testTypes,
      coverage: args.coverage,
      focusAreas: args.focusAreas,
      maxScenarios: args.maxScenarios,
    });
    return json(result);
  },
};

const createTestPlanTool: RegisteredTool = {
  name: 'create_test_plan',
  description: '[mode: real] Build a test plan from stored scenarios with filtering / scheduling.',
  inputShape: {
    projectPath: z.string(),
    name: z.string(),
    priorityFilter: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
    typeFilter: z.array(z.string()).optional(),
    template: z.enum(['smoke', 'regression', 'nightly', 'full']).optional(),
    maxDuration: z.number().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const scenarios = storage.getScenarios(projectPath);

    if (args.template) {
      const result = createQuickPlan(
        appStructure,
        scenarios.map((s) => s.scenario),
        args.template,
      );
      return { text: result.summary };
    }

    const result = createTestPlan({
      name: args.name,
      scenarios: scenarios.map((s) => s.scenario),
      appStructure,
      priorityFilter: args.priorityFilter,
      typeFilter: args.typeFilter,
      maxDuration: args.maxDuration,
    });
    return { text: result.summary };
  },
};

const runScenarioTestTool: RegisteredTool = {
  name: 'run_scenario_test',
  description: '[mode: hybrid] Run a stored scenario; real subprocess where possible, falls back to simulated.',
  inputShape: {
    projectPath: z.string(),
    scenarioId: z.string(),
    platform: PlatformEnum,
    device: z.string().optional(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
  },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const result = await runScenarioTest({
      scenarioId: args.scenarioId,
      projectPath,
      platform: args.platform,
      device: args.device,
      options: { timeout: args.timeout, retries: args.retries },
    });
    return { text: result.summary };
  },
};

const runSimulationTool: RegisteredTool = {
  name: 'run_simulation',
  description: '[mode: simulated] Random / sequential user-behavior simulation to find issues.',
  inputShape: {
    projectPath: z.string(),
    duration: z.number(),
    userPatterns: z.array(z.enum(['random', 'sequential', 'stress', 'idle'])).optional(),
    intensity: z.enum(['low', 'medium', 'high']).optional(),
    monitorMetrics: z.array(z.enum(['memory', 'cpu', 'network', 'render'])).optional(),
  },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const result = await runSimulation({
      appStructure,
      duration: args.duration,
      userPatterns: args.userPatterns,
      intensity: args.intensity,
      monitorMetrics: args.monitorMetrics,
    });
    return { text: result.summary };
  },
};

const runStressTestTool: RegisteredTool = {
  name: 'run_stress_test',
  description: '[mode: hybrid] Concurrency / load test against an endpoint or UI surface.',
  inputShape: {
    projectPath: z.string(),
    targetType: z.enum(['api', 'ui', 'navigation', 'all']),
    concurrency: z.number(),
    duration: z.number(),
    rampUp: z.number().optional(),
    endpoints: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const result = await runStressTest({
      appStructure,
      targetType: args.targetType,
      concurrency: args.concurrency,
      duration: args.duration,
      rampUp: args.rampUp,
      endpoints: args.endpoints,
    });
    return { text: result.summary };
  },
};

const detectMemoryLeaksTool: RegisteredTool = {
  name: 'detect_memory_leaks',
  description: '[mode: real] Detect memory leaks, retain cycles, unclosed resources.',
  inputShape: {
    projectPath: z.string(),
    analysisType: z.enum(['static', 'dynamic', 'both']).optional(),
    minLeakSizeMB: z.number().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const result = detectMemoryLeaks({
      appStructure,
      analysisType: args.analysisType,
      thresholds: { minLeakSizeMB: args.minLeakSizeMB },
    });
    return { text: JSON.stringify(result.summary, null, 2) + '\n\n' + result.recommendations.join('\n') };
  },
};

const detectLogicErrorsTool: RegisteredTool = {
  name: 'detect_logic_errors',
  description: '[mode: real] Detect race conditions, null refs, state inconsistencies.',
  inputShape: {
    projectPath: z.string(),
    analysisDepth: z.enum(['shallow', 'normal', 'deep']).optional(),
    checkTypes: z.array(z.enum(['race_condition', 'state_inconsistency', 'null_reference', 'type_mismatch', 'all'])).optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const result = detectLogicErrors({
      appStructure,
      analysisDepth: args.analysisDepth,
      checkTypes: args.checkTypes,
    });
    return { text: JSON.stringify(result.summary, null, 2) + '\n\n' + result.recommendations.join('\n') };
  },
};

const suggestFixesTool: RegisteredTool = {
  name: 'suggest_fixes',
  description: '[mode: real] Generate rule-based fix suggestions for detected issues.',
  inputShape: {
    projectPath: z.string(),
    issueIds: z.array(z.string()).optional(),
    maxSuggestions: z.number().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const issues = storage.getIssues(projectPath);
    const appStructure = analyzeAppStructure({ projectPath });
    const filteredIssues = args.issueIds
      ? issues.filter((i) => (args.issueIds as string[]).includes(i.id))
      : issues;
    const result = suggestFixes({
      issues: filteredIssues,
      projectPath,
      platform: appStructure.platform,
      maxSuggestions: args.maxSuggestions,
    });
    return json(result.summary);
  },
};

const confirmFixTool: RegisteredTool = {
  name: 'confirm_fix',
  description: '[mode: real] Confirm / reject / modify a proposed fix prior to apply.',
  inputShape: {
    fixId: z.string(),
    action: z.enum(['approve', 'reject', 'modify']),
    modifiedCode: z.string().optional(),
    reason: z.string().optional(),
  },
  handler: (args) => {
    const result = confirmFix({
      fixId: args.fixId,
      action: args.action,
      modifiedCode: args.modifiedCode,
      reason: args.reason,
    });
    return { text: result.message };
  },
};

const applyFixTool: RegisteredTool = {
  name: 'apply_fix',
  description: '[mode: real] Apply a confirmed fix. backup=true, validate=true by default. Supports dryRun.',
  inputShape: {
    fixId: z.string(),
    backup: z.boolean().optional(),
    validate: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  },
  handler: (args) => {
    const result = applyFix({
      fixId: args.fixId,
      backup: args.backup,
      validate: args.validate,
      dryRun: args.dryRun,
    });
    if (result.success) {
      return { text: `Fix applied successfully!\n\n${result.diff || ''}` };
    }
    return { text: `Fix failed: ${result.error}`, isError: true };
  },
};

const rollbackFixTool: RegisteredTool = {
  name: 'rollback_fix',
  description: '[mode: real] Restore the pre-apply file content from the backup.',
  inputShape: { fixId: z.string() },
  handler: (args) => {
    const result = rollbackFix(args.fixId);
    return { text: result.message };
  },
};

const runFullAutomationTool: RegisteredTool = {
  name: 'run_full_automation',
  description: '[mode: hybrid] Analyze → plan → execute → detect → suggest in one call.',
  inputShape: {
    projectPath: z.string(),
    platform: PlatformEnum.optional(),
    testTypes: z.array(TestTypeEnum).optional(),
    autoApply: z.boolean().optional(),
    /** @deprecated v3.0.0 — use autoApply. */
    autoFix: z.boolean().optional(),
    /** @deprecated v3.0.0 — use autoApply. */
    confirmMode: z.enum(['auto', 'interactive', 'batch']).optional(),
  },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    // Backwards compat shim — `autoApply: true` ↔ confirmMode='auto'.
    const autoApply = args.autoApply ?? args.autoFix ?? false;
    const confirmMode = args.confirmMode ?? (autoApply ? 'auto' : 'batch');

    const result = await runFullAutomation({
      projectPath,
      platform: args.platform,
      testTypes: args.testTypes,
      autoFix: autoApply,
      confirmMode,
    });

    let response = result.summary;
    if (result.pendingConfirmations.length > 0) {
      response += '\n\n### Pending Fix Confirmations\n\n';
      for (const fix of result.pendingConfirmations.slice(0, 5)) {
        response += generateConfirmationPrompt(fix) + '\n\n';
      }
    }
    return { text: response };
  },
};

const runIterativeFixLoopTool: RegisteredTool = {
  name: 'run_iterative_fix_loop',
  description:
    '[mode: hybrid, headline tool] Self-healing test → fix → re-test loop with regression detection, auto-rollback, and resumeToken support. See docs/ITERATE_FIX_LOOP.md.',
  inputShape: {
    projectPath: z.string(),
    strategy: z.enum(['rule-based', 'llm', 'hybrid']).optional(),
    maxIterations: z.number().int().min(1).max(20).optional(),
    acceptableThreshold: z.number().min(0).max(100).optional(),
    autoApply: z.boolean().optional(),
    timeoutPerIteration: z.number().optional(),
    totalTimeout: z.number().optional(),
    hybridConfidenceThreshold: z.number().optional(),
    resumeToken: z.string().optional(),
  },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const result = await runIterativeFixLoop({
      projectPath,
      strategy: args.strategy,
      maxIterations: args.maxIterations,
      acceptableThreshold: args.acceptableThreshold,
      autoApply: args.autoApply,
      timeoutPerIteration: args.timeoutPerIteration,
      totalTimeout: args.totalTimeout,
      hybridConfidenceThreshold: args.hybridConfidenceThreshold,
      resumeToken: args.resumeToken,
    });

    let text = result.summary + '\n\n';
    text += `Loop ID: ${result.loopId}\n`;
    if (result.resumeToken) text += `Resume token: ${result.resumeToken}\n`;
    if (result.pendingConfirmations) {
      text += `\nPending confirmations (${result.pendingConfirmations.length}):\n`;
      for (const fix of result.pendingConfirmations.slice(0, 5)) {
        text += `  - ${fix.id}: ${fix.title} (confidence: ${fix.confidence})\n`;
      }
    }
    return { text };
  },
};

const generateReportTool: RegisteredTool = {
  name: 'generate_report',
  description: '[mode: real] Generate Markdown / HTML / JSON test automation report.',
  inputShape: {
    projectPath: z.string(),
    format: z.enum(['markdown', 'html', 'json']).optional(),
    sections: z.array(z.enum(['summary', 'details', 'issues', 'fixes', 'recommendations'])).optional(),
    outputPath: z.string().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const fixes = storage.getFixes(projectPath);
    const issues = storage.getIssues(projectPath);
    const results = storage.getTestResults(projectPath);
    const appStructure = analyzeAppStructure({ projectPath });

    const result = generateReport({
      automationResult: {
        id: 'manual',
        config: {
          projectPath,
          platform: appStructure.platform,
          testTypes: ['e2e'],
          autoFix: false,
          confirmMode: 'batch',
          thresholds: { memoryLeakSizeMB: 10, cpuUsagePercent: 80, renderTimeMs: 16, apiTimeoutMs: 5000, coveragePercent: 80 },
        },
        appStructure,
        testPlan: {
          id: 'manual', name: 'Manual', description: '', scenarios: [],
          coverage: { screens: 0, components: 0, apis: 0, stateTransitions: 0, edgeCases: 0 },
          createdAt: new Date().toISOString(),
        },
        testResults: results.map((r) => r.result),
        detectedIssues: issues,
        fixSuggestions: fixes.map((f) => f.fix),
        appliedFixes: fixes.filter((f) => f.application).map((f) => f.application!),
        summary: {
          totalScenarios: results.length,
          passedScenarios: results.filter((r) => r.result.status === 'passed').length,
          failedScenarios: results.filter((r) => r.result.status === 'failed').length,
          totalIssues: issues.length,
          criticalIssues: issues.filter((i) => i.severity === 'critical').length,
          fixesApplied: fixes.filter((f) => f.application?.success).length,
          coveragePercent: 0,
          duration: 0,
        },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      format: args.format,
      sections: args.sections,
      outputPath: args.outputPath,
    });
    return { text: result.content.substring(0, 10000) };
  },
};

const getPendingFixesTool: RegisteredTool = {
  name: 'get_pending_fixes',
  description: '[mode: real] List fixes awaiting confirmation for the project.',
  inputShape: { projectPath: z.string() },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const fixes = storage.getPendingFixes(projectPath);
    return json(fixes.map((f) => ({ id: f.fix.id, title: f.fix.title, file: f.fix.file, confidence: f.fix.confidence })));
  },
};

const getTestHistoryTool: RegisteredTool = {
  name: 'get_test_history',
  description: '[mode: real] Recent test executions for the project.',
  inputShape: {
    projectPath: z.string(),
    limit: z.number().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const history = storage.getTestResults(projectPath, args.limit);
    return json(history.map((h) => ({
      id: h.result.id, scenario: h.result.scenarioName, status: h.result.status,
      duration: h.result.duration, executedAt: h.result.executedAt,
    })));
  },
};

const analyzePerformanceTool: RegisteredTool = {
  name: 'analyze_performance',
  description: '[mode: real] Static performance analysis: rendering, computation, bundle.',
  inputShape: { projectPath: z.string(), platform: PlatformEnum.optional() },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath, platform: args.platform });
    const result = await analyzePerformance(projectPath, appStructure.platform);
    let text = `# Performance Analysis Report\n\n**Score:** ${result.summary.performanceScore}/100\n\n`;
    text += `**Issues:** Critical: ${result.summary.criticalIssues} | Major: ${result.summary.majorIssues} | Minor: ${result.summary.minorIssues}\n\n`;
    if (result.recommendations.length > 0) {
      text += `## Top Recommendations\n\n`;
      for (const rec of result.recommendations.slice(0, 5)) {
        text += `### [${rec.priority.toUpperCase()}] ${rec.category}\n${rec.description}\n*Expected impact: ${rec.estimatedImpact}*\n\n`;
      }
    }
    return { text };
  },
};

const analyzeCodeDeepTool: RegisteredTool = {
  name: 'analyze_code_deep',
  description: '[mode: real] Deep AST analysis: functions, complexity, hooks, issues.',
  inputShape: { projectPath: z.string(), platform: PlatformEnum.optional() },
  handler: async (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath, platform: args.platform });
    const result = await analyzeProject(projectPath, appStructure.platform);
    let text = `# Deep Code Analysis\n\n`;
    text += `**Files:** ${result.summary.totalFiles} | **Functions:** ${result.summary.totalFunctions} | **Classes:** ${result.summary.totalClasses} | **Components:** ${result.summary.totalComponents}\n`;
    text += `**Avg Complexity:** ${result.summary.avgComplexity.toFixed(2)}\n`;
    text += `**Issues:** Errors: ${result.summary.issueCount.error} | Warnings: ${result.summary.issueCount.warning} | Info: ${result.summary.issueCount.info}\n`;
    return { text };
  },
};

const generateCICDTool: RegisteredTool = {
  name: 'generate_cicd_config',
  description: '[mode: real] Generate GitHub Actions / Jenkins / GitLab CI configuration.',
  inputShape: {
    projectPath: z.string(),
    provider: z.enum(['github-actions', 'jenkins', 'gitlab-ci']),
    platform: PlatformEnum.optional(),
    testCommand: z.string().optional(),
    buildCommand: z.string().optional(),
    branches: z.array(z.string()).optional(),
    writeToFile: z.boolean().optional(),
  },
  handler: (args) => {
    const projectPath = safePath(args.projectPath);
    const appStructure = analyzeAppStructure({ projectPath, platform: args.platform });
    const cicdConfig = {
      projectPath,
      platform: appStructure.platform,
      provider: args.provider,
      options: {
        testCommand: args.testCommand,
        buildCommand: args.buildCommand,
        branches: args.branches,
      },
    };
    if (args.writeToFile) {
      const result = writeCICDConfig(cicdConfig);
      if (result.success) {
        return { text: `CI/CD config written to:\n${result.files.join('\n')}` };
      }
      return { text: 'Failed to write CI/CD config', isError: true };
    }
    const result = generateCICDConfig(cicdConfig);
    return { text: `# ${result.provider} Configuration\n\nFile: \`${result.filePath}\`\n\n\`\`\`yaml\n${result.content}\n\`\`\`` };
  },
};

// ---------------------------------------------------------------------------
// Registry — order matters: this is the display order in tools/list.
// ---------------------------------------------------------------------------
export const TOOL_REGISTRY: readonly RegisteredTool[] = [
  analyzeAppStructureTool,
  generateScenariosTool,
  createTestPlanTool,
  runScenarioTestTool,
  runSimulationTool,
  runStressTestTool,
  detectMemoryLeaksTool,
  detectLogicErrorsTool,
  suggestFixesTool,
  confirmFixTool,
  applyFixTool,
  rollbackFixTool,
  runFullAutomationTool,
  runIterativeFixLoopTool, // ★ v3.0.0 headline
  generateReportTool,
  getPendingFixesTool,
  getTestHistoryTool,
  analyzePerformanceTool,
  analyzeCodeDeepTool,
  generateCICDTool,
];

export function getToolNames(): string[] {
  return TOOL_REGISTRY.map((t) => t.name);
}
