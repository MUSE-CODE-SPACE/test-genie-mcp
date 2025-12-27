// ============================================
// Run Scenario Test Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  TestScenario,
  TestResult,
  StepResult,
  Platform,
  ErrorInfo,
} from '../../types.js';
import { saveTestResult, getScenarioById } from '../../storage/index.js';

const execAsync = promisify(exec);

interface RunScenarioTestParams {
  scenarioId?: string;
  scenario?: TestScenario;
  projectPath: string;
  platform: Platform;
  device?: string;
  options?: {
    timeout?: number;
    retries?: number;
    screenshots?: boolean;
    verbose?: boolean;
  };
}

interface RunScenarioTestResult {
  result: TestResult;
  success: boolean;
  duration: number;
  summary: string;
}

export async function runScenarioTest(params: RunScenarioTestParams): Promise<RunScenarioTestResult> {
  const {
    scenarioId,
    projectPath,
    platform,
    device,
    options = {},
  } = params;

  const { timeout = 60000, retries = 1, screenshots = true, verbose = false } = options;

  // Get scenario
  let scenario = params.scenario;
  if (!scenario && scenarioId) {
    const stored = getScenarioById(scenarioId);
    if (!stored) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    scenario = stored.scenario;
  }

  if (!scenario) {
    throw new Error('Scenario is required');
  }

  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  const logs: string[] = [];
  const screenshotPaths: string[] = [];
  let error: ErrorInfo | undefined;
  let overallStatus: TestResult['status'] = 'passed';

  // Execute each step
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (attempt > 1) {
      logs.push(`Retry attempt ${attempt}/${retries}`);
    }

    for (const step of scenario.steps) {
      const stepStartTime = Date.now();
      let stepStatus: StepResult['status'] = 'passed';
      let stepError: string | undefined;
      let actualOutput: string | undefined;

      try {
        if (verbose) {
          logs.push(`Step ${step.order}: ${step.action} - ${step.target || ''}`);
        }

        // Execute step based on action type
        const result = await executeStep(step, platform, projectPath, device, timeout);
        actualOutput = result.output;

        // Verify expected output
        if (step.expectedOutput && result.output) {
          if (!result.output.toLowerCase().includes(step.expectedOutput.toLowerCase())) {
            stepStatus = 'failed';
            stepError = `Expected: ${step.expectedOutput}, Got: ${result.output}`;
          }
        }

        // Take screenshot if enabled
        if (screenshots && platform !== 'web') {
          const screenshotPath = await takeScreenshot(platform, projectPath, step.order);
          if (screenshotPath) {
            screenshotPaths.push(screenshotPath);
          }
        }
      } catch (err) {
        stepStatus = 'failed';
        stepError = err instanceof Error ? err.message : String(err);

        if (!error) {
          error = {
            type: 'StepExecutionError',
            message: stepError,
            stackTrace: err instanceof Error ? err.stack : undefined,
          };
        }
      }

      const stepDuration = Date.now() - stepStartTime;

      stepResults.push({
        order: step.order,
        action: step.action,
        status: stepStatus,
        duration: stepDuration,
        actualOutput,
        error: stepError,
      });

      if (stepStatus === 'failed') {
        overallStatus = 'failed';
        break; // Stop on first failure
      }
    }

    if (overallStatus === 'passed') {
      break; // Success, no need to retry
    }
  }

  const duration = Date.now() - startTime;

  const result: TestResult = {
    id: uuidv4(),
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status: overallStatus,
    duration,
    steps: stepResults,
    logs,
    screenshots: screenshotPaths.length > 0 ? screenshotPaths : undefined,
    error,
    executedAt: new Date().toISOString(),
  };

  // Save result
  saveTestResult(result, projectPath);

  return {
    result,
    success: overallStatus === 'passed',
    duration,
    summary: generateTestSummary(result, scenario),
  };
}

async function executeStep(
  step: { order: number; action: string; target?: string; input?: string; expectedOutput?: string; timeout?: number },
  platform: Platform,
  projectPath: string,
  device?: string,
  defaultTimeout?: number
): Promise<{ output: string; success: boolean }> {
  const timeout = step.timeout || defaultTimeout || 30000;

  // Simulate step execution based on action type
  // In a real implementation, this would integrate with actual test frameworks

  switch (step.action) {
    case 'navigate':
      return await simulateNavigation(step.target || '', platform, projectPath, device);

    case 'tap':
    case 'click':
      return await simulateTap(step.target || '', platform, projectPath, device);

    case 'type':
    case 'input':
      return await simulateInput(step.target || '', step.input || '', platform, projectPath, device);

    case 'verify':
      return await simulateVerify(step.target || '', step.expectedOutput || '', platform, projectPath, device);

    case 'wait':
      await sleep(parseInt(step.input || '1000'));
      return { output: 'Wait completed', success: true };

    case 'scroll':
      return await simulateScroll(step.target || '', step.input || 'down', platform, projectPath, device);

    case 'mock':
      return { output: `Mocked ${step.target}`, success: true };

    case 'snapshot':
    case 'measure':
    case 'compare':
      return { output: `${step.action} completed for ${step.target}`, success: true };

    case 'render':
    case 'mount':
    case 'unmount':
      return { output: `${step.action} ${step.target} completed`, success: true };

    default:
      return { output: `Unknown action: ${step.action}`, success: false };
  }
}

async function simulateNavigation(
  target: string,
  platform: Platform,
  projectPath: string,
  device?: string
): Promise<{ output: string; success: boolean }> {
  // Simulate navigation delay
  await sleep(500 + Math.random() * 500);

  // In real implementation, this would use platform-specific tools:
  // - iOS: xcrun simctl / XCUITest
  // - Android: adb / Espresso
  // - Flutter: flutter drive
  // - React Native: Detox

  return {
    output: `Navigated to ${target}`,
    success: true,
  };
}

async function simulateTap(
  target: string,
  platform: Platform,
  projectPath: string,
  device?: string
): Promise<{ output: string; success: boolean }> {
  await sleep(200 + Math.random() * 300);

  return {
    output: `Tapped ${target}`,
    success: true,
  };
}

async function simulateInput(
  target: string,
  text: string,
  platform: Platform,
  projectPath: string,
  device?: string
): Promise<{ output: string; success: boolean }> {
  await sleep(100 * text.length);

  return {
    output: `Entered "${text}" into ${target}`,
    success: true,
  };
}

async function simulateVerify(
  target: string,
  expected: string,
  platform: Platform,
  projectPath: string,
  device?: string
): Promise<{ output: string; success: boolean }> {
  await sleep(300 + Math.random() * 200);

  // Simulate verification (in real implementation, would check actual UI state)
  const success = Math.random() > 0.1; // 90% success rate for simulation

  return {
    output: success ? expected : 'Element not found or mismatch',
    success,
  };
}

async function simulateScroll(
  target: string,
  direction: string,
  platform: Platform,
  projectPath: string,
  device?: string
): Promise<{ output: string; success: boolean }> {
  await sleep(300 + Math.random() * 200);

  return {
    output: `Scrolled ${direction} on ${target}`,
    success: true,
  };
}

async function takeScreenshot(
  platform: Platform,
  projectPath: string,
  stepNumber: number
): Promise<string | null> {
  const screenshotsDir = path.join(projectPath, '.test-genie', 'screenshots');

  try {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const filename = `step_${stepNumber}_${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);

    // In real implementation, would capture actual screenshot
    // For now, just return the path that would be used
    return filepath;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateTestSummary(result: TestResult, scenario: TestScenario): string {
  const lines: string[] = [];

  const statusEmoji = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';

  lines.push(`${statusEmoji} ${scenario.name}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Status: ${result.status.toUpperCase()}`);
  lines.push(`Duration: ${result.duration}ms`);
  lines.push(`Steps: ${result.steps.filter(s => s.status === 'passed').length}/${result.steps.length} passed`);

  if (result.error) {
    lines.push(`\nError: ${result.error.message}`);
  }

  const failedSteps = result.steps.filter(s => s.status === 'failed');
  if (failedSteps.length > 0) {
    lines.push(`\nFailed Steps:`);
    for (const step of failedSteps) {
      lines.push(`  - Step ${step.order}: ${step.action} - ${step.error}`);
    }
  }

  return lines.join('\n');
}

// Run multiple scenarios
export async function runScenarios(
  scenarios: TestScenario[],
  projectPath: string,
  platform: Platform,
  options?: {
    parallel?: boolean;
    maxParallel?: number;
    stopOnFailure?: boolean;
  }
): Promise<{
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}> {
  const { parallel = false, maxParallel = 3, stopOnFailure = false } = options || {};

  const results: TestResult[] = [];
  const startTime = Date.now();

  if (parallel) {
    // Run scenarios in parallel batches
    for (let i = 0; i < scenarios.length; i += maxParallel) {
      const batch = scenarios.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map(scenario =>
          runScenarioTest({ scenario, projectPath, platform })
            .then(r => r.result)
            .catch(err => ({
              id: uuidv4(),
              scenarioId: scenario.id,
              scenarioName: scenario.name,
              status: 'error' as const,
              duration: 0,
              steps: [],
              logs: [],
              error: { type: 'ExecutionError', message: err.message },
              executedAt: new Date().toISOString(),
            }))
        )
      );
      results.push(...batchResults);

      if (stopOnFailure && batchResults.some(r => r.status === 'failed' || r.status === 'error')) {
        break;
      }
    }
  } else {
    // Run scenarios sequentially
    for (const scenario of scenarios) {
      try {
        const { result } = await runScenarioTest({ scenario, projectPath, platform });
        results.push(result);

        if (stopOnFailure && (result.status === 'failed' || result.status === 'error')) {
          break;
        }
      } catch (err) {
        results.push({
          id: uuidv4(),
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          status: 'error',
          duration: 0,
          steps: [],
          logs: [],
          error: { type: 'ExecutionError', message: err instanceof Error ? err.message : String(err) },
          executedAt: new Date().toISOString(),
        });

        if (stopOnFailure) {
          break;
        }
      }
    }
  }

  const duration = Date.now() - startTime;

  return {
    results,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    duration,
  };
}

export default runScenarioTest;
