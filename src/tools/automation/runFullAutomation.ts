// ============================================
// Run Full Automation Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import {
  AutomationConfig,
  AutomationResult,
  AutomationSummary,
  AppStructure,
  TestPlan,
  TestResult,
  SimulationResult,
  DetectedIssue,
  FixSuggestion,
  FixApplication,
  Platform,
} from '../../types.js';
import { analyzeAppStructure } from '../analysis/analyzeAppStructure.js';
import { generateScenarios } from '../analysis/generateScenarios.js';
import { createTestPlan } from '../analysis/createTestPlan.js';
import { runScenarios } from '../execution/runScenarioTest.js';
import { runSimulation } from '../execution/runSimulation.js';
import { detectMemoryLeaks } from '../detection/detectMemoryLeaks.js';
import { detectLogicErrors } from '../detection/detectLogicErrors.js';
import { suggestFixes } from '../fixing/suggestFixes.js';
import { confirmFix, generateConfirmationPrompt } from '../fixing/confirmFix.js';
import { applyFix } from '../fixing/applyFix.js';

interface RunFullAutomationParams {
  projectPath: string;
  platform?: Platform;
  testTypes?: ('unit' | 'integration' | 'e2e' | 'performance' | 'memory')[];
  autoFix?: boolean;
  confirmMode?: 'auto' | 'interactive' | 'batch';
  thresholds?: {
    memoryLeakSizeMB?: number;
    cpuUsagePercent?: number;
    coveragePercent?: number;
  };
  skipPhases?: ('analysis' | 'scenarios' | 'execution' | 'detection' | 'fixing')[];
  onProgress?: (phase: string, progress: number, message: string) => void;
  onConfirmRequired?: (fix: FixSuggestion) => Promise<'approve' | 'reject' | 'modify'>;
}

interface RunFullAutomationResult {
  result: AutomationResult;
  success: boolean;
  pendingConfirmations: FixSuggestion[];
  summary: string;
}

export async function runFullAutomation(params: RunFullAutomationParams): Promise<RunFullAutomationResult> {
  const {
    projectPath,
    platform,
    testTypes = ['unit', 'integration', 'e2e'],
    autoFix = false,
    confirmMode = 'interactive',
    thresholds = {},
    skipPhases = [],
    onProgress,
    onConfirmRequired,
  } = params;

  const startTime = Date.now();
  const automationId = uuidv4();

  let appStructure: AppStructure | null = null;
  let testPlan: TestPlan | null = null;
  let testResults: TestResult[] = [];
  let simulationResult: SimulationResult | null = null;
  let detectedIssues: DetectedIssue[] = [];
  let fixSuggestions: FixSuggestion[] = [];
  let appliedFixes: FixApplication[] = [];
  const pendingConfirmations: FixSuggestion[] = [];

  try {
    // ============================================
    // Phase 1: App Analysis
    // ============================================
    if (!skipPhases.includes('analysis')) {
      onProgress?.('analysis', 0, 'Starting app analysis...');

      appStructure = analyzeAppStructure({
        projectPath,
        platform,
        depth: 'normal',
      });

      onProgress?.('analysis', 100, `Analyzed ${appStructure.screens.length} screens, ${appStructure.components.length} components`);
    }

    if (!appStructure) {
      throw new Error('App structure analysis is required');
    }

    // ============================================
    // Phase 2: Scenario Generation
    // ============================================
    if (!skipPhases.includes('scenarios')) {
      onProgress?.('scenarios', 0, 'Generating test scenarios...');

      const scenarioResult = generateScenarios({
        appStructure,
        testTypes,
        coverage: 'standard',
      });

      onProgress?.('scenarios', 50, `Generated ${scenarioResult.scenarios.length} scenarios`);

      // Create test plan
      const planResult = createTestPlan({
        name: 'Automated Test Plan',
        scenarios: scenarioResult.scenarios,
        appStructure,
      });

      testPlan = planResult.plan;

      onProgress?.('scenarios', 100, `Test plan created with ${testPlan.scenarios.length} scenarios`);
    }

    if (!testPlan) {
      throw new Error('Test plan generation is required');
    }

    // ============================================
    // Phase 3: Test Execution
    // ============================================
    if (!skipPhases.includes('execution')) {
      onProgress?.('execution', 0, 'Running test scenarios...');

      // Run scenarios
      const executionResult = await runScenarios(
        testPlan.scenarios,
        projectPath,
        appStructure.platform,
        { parallel: true, maxParallel: 5 }
      );

      testResults = executionResult.results;

      onProgress?.('execution', 50, `${executionResult.passed}/${executionResult.results.length} tests passed`);

      // Run simulation if memory test is included
      if (testTypes.includes('memory') || testTypes.includes('performance')) {
        const simResult = await runSimulation({
          appStructure,
          duration: 60, // 1 minute simulation
          userPatterns: ['random', 'sequential'],
          intensity: 'medium',
        });

        simulationResult = simResult.result;
      }

      onProgress?.('execution', 100, 'Test execution completed');
    }

    // ============================================
    // Phase 4: Issue Detection
    // ============================================
    if (!skipPhases.includes('detection')) {
      onProgress?.('detection', 0, 'Detecting issues...');

      // Detect memory leaks
      const memoryResult = detectMemoryLeaks({
        appStructure,
        analysisType: 'both',
        thresholds: {
          minLeakSizeMB: thresholds.memoryLeakSizeMB || 5,
        },
      });

      detectedIssues.push(...memoryResult.issues);

      onProgress?.('detection', 50, `Found ${memoryResult.issues.length} memory issues`);

      // Detect logic errors
      const logicResult = detectLogicErrors({
        appStructure,
        analysisDepth: 'normal',
      });

      detectedIssues.push(...logicResult.issues);

      onProgress?.('detection', 100, `Total issues found: ${detectedIssues.length}`);
    }

    // ============================================
    // Phase 5: Fix Generation & Application
    // ============================================
    if (!skipPhases.includes('fixing') && detectedIssues.length > 0) {
      onProgress?.('fixing', 0, 'Generating fix suggestions...');

      // Generate fix suggestions
      const fixResult = suggestFixes({
        issues: detectedIssues,
        projectPath,
        platform: appStructure.platform,
      });

      fixSuggestions = fixResult.suggestions;

      onProgress?.('fixing', 30, `Generated ${fixSuggestions.length} fix suggestions`);

      // Handle fixes based on confirm mode
      if (autoFix && confirmMode === 'auto') {
        // Auto-apply high-confidence fixes
        for (const fix of fixSuggestions.filter(f => f.confidence >= 90)) {
          confirmFix({ fixId: fix.id, action: 'approve' });
          const result = applyFix({ fixId: fix.id, backup: true, validate: true });
          if (result.success) {
            appliedFixes.push(result.application);
          }
        }
      } else if (confirmMode === 'interactive' && onConfirmRequired) {
        // Interactive confirmation
        for (const fix of fixSuggestions) {
          const action = await onConfirmRequired(fix);

          if (action === 'approve') {
            confirmFix({ fixId: fix.id, action: 'approve' });
            const result = applyFix({ fixId: fix.id, backup: true, validate: true });
            if (result.success) {
              appliedFixes.push(result.application);
            }
          } else if (action === 'reject') {
            confirmFix({ fixId: fix.id, action: 'reject' });
          }
        }
      } else {
        // Batch mode - collect all for later confirmation
        pendingConfirmations.push(...fixSuggestions);
      }

      onProgress?.('fixing', 100, `Applied ${appliedFixes.length} fixes`);
    }

    // ============================================
    // Generate Summary
    // ============================================
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    const summary: AutomationSummary = {
      totalScenarios: testPlan.scenarios.length,
      passedScenarios: testResults.filter(r => r.status === 'passed').length,
      failedScenarios: testResults.filter(r => r.status === 'failed').length,
      totalIssues: detectedIssues.length,
      criticalIssues: detectedIssues.filter(i => i.severity === 'critical').length,
      fixesApplied: appliedFixes.length,
      coveragePercent: testPlan.coverage.screens,
      duration,
    };

    const result: AutomationResult = {
      id: automationId,
      config: {
        projectPath,
        platform: appStructure.platform,
        testTypes,
        autoFix,
        confirmMode,
        thresholds: {
          memoryLeakSizeMB: thresholds.memoryLeakSizeMB || 10,
          cpuUsagePercent: thresholds.cpuUsagePercent || 80,
          renderTimeMs: 16,
          apiTimeoutMs: 5000,
          coveragePercent: thresholds.coveragePercent || 80,
        },
      },
      appStructure,
      testPlan,
      testResults,
      simulationResult: simulationResult || undefined,
      detectedIssues,
      fixSuggestions,
      appliedFixes,
      summary,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
    };

    return {
      result,
      success: true,
      pendingConfirmations,
      summary: generateAutomationSummary(result),
    };

  } catch (error) {
    return {
      result: {
        id: automationId,
        config: {
          projectPath,
          platform: platform || 'web',
          testTypes,
          autoFix,
          confirmMode,
          thresholds: {
            memoryLeakSizeMB: 10,
            cpuUsagePercent: 80,
            renderTimeMs: 16,
            apiTimeoutMs: 5000,
            coveragePercent: 80,
          },
        },
        appStructure: appStructure!,
        testPlan: testPlan!,
        testResults,
        detectedIssues,
        fixSuggestions,
        appliedFixes,
        summary: {
          totalScenarios: 0,
          passedScenarios: 0,
          failedScenarios: 0,
          totalIssues: 0,
          criticalIssues: 0,
          fixesApplied: 0,
          coveragePercent: 0,
          duration: (Date.now() - startTime) / 1000,
        },
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      },
      success: false,
      pendingConfirmations: [],
      summary: `Automation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function generateAutomationSummary(result: AutomationResult): string {
  const lines: string[] = [];
  const { summary } = result;

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🤖 Test Automation Complete');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`📁 Project: ${result.config.projectPath}`);
  lines.push(`📱 Platform: ${result.config.platform}`);
  lines.push(`⏱️  Duration: ${summary.duration.toFixed(1)}s`);
  lines.push('');
  lines.push('📊 Test Results:');
  lines.push(`   ✅ Passed: ${summary.passedScenarios}/${summary.totalScenarios}`);
  lines.push(`   ❌ Failed: ${summary.failedScenarios}/${summary.totalScenarios}`);
  lines.push(`   📈 Coverage: ${summary.coveragePercent}%`);
  lines.push('');
  lines.push('🔍 Issues Detected:');
  lines.push(`   Total: ${summary.totalIssues}`);
  lines.push(`   🔴 Critical: ${summary.criticalIssues}`);
  lines.push('');
  lines.push('🔧 Fixes:');
  lines.push(`   Suggested: ${result.fixSuggestions.length}`);
  lines.push(`   Applied: ${summary.fixesApplied}`);

  if (result.simulationResult) {
    lines.push('');
    lines.push('📈 Simulation Results:');
    lines.push(`   Duration: ${result.simulationResult.duration.toFixed(1)}s`);
    lines.push(`   User Actions: ${result.simulationResult.userActions}`);
    lines.push(`   Memory Peak: ${result.simulationResult.memoryPeakMB}MB`);
    lines.push(`   CPU Peak: ${result.simulationResult.cpuPeakPercent}%`);
    lines.push(`   Anomalies: ${result.simulationResult.anomalies.length}`);
  }

  // Status
  const overallStatus = summary.criticalIssues === 0 && summary.failedScenarios === 0
    ? '✅ HEALTHY'
    : summary.criticalIssues > 0
      ? '🔴 CRITICAL ISSUES'
      : '⚠️ ISSUES FOUND';

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Status: ${overallStatus}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

export default runFullAutomation;
