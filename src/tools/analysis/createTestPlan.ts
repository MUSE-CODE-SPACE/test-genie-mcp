// ============================================
// Create Test Plan Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import { TestScenario, TestPlan, CoverageInfo, ScheduleInfo, AppStructure } from '../../types.js';
import { saveTestPlan } from '../../storage/index.js';

interface CreateTestPlanParams {
  name: string;
  description?: string;
  scenarios: TestScenario[];
  appStructure: AppStructure;
  priorityFilter?: ('critical' | 'high' | 'medium' | 'low')[];
  typeFilter?: string[];
  schedule?: ScheduleInfo;
  maxDuration?: number; // max total duration in seconds
}

interface CreateTestPlanResult {
  plan: TestPlan;
  excludedScenarios: TestScenario[];
  estimatedDuration: number;
  summary: string;
}

export function createTestPlan(params: CreateTestPlanParams): CreateTestPlanResult {
  const {
    name,
    description = '',
    scenarios,
    appStructure,
    priorityFilter,
    typeFilter,
    schedule,
    maxDuration,
  } = params;

  // Filter scenarios
  let filteredScenarios = [...scenarios];

  // Filter by priority
  if (priorityFilter && priorityFilter.length > 0) {
    filteredScenarios = filteredScenarios.filter(s =>
      priorityFilter.includes(s.priority)
    );
  }

  // Filter by type
  if (typeFilter && typeFilter.length > 0) {
    filteredScenarios = filteredScenarios.filter(s =>
      typeFilter.includes(s.type)
    );
  }

  // Sort by priority (critical > high > medium > low)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  filteredScenarios.sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  // Apply max duration limit
  let includedScenarios: TestScenario[] = [];
  let excludedScenarios: TestScenario[] = [];
  let totalDuration = 0;

  if (maxDuration) {
    for (const scenario of filteredScenarios) {
      if (totalDuration + scenario.estimatedDuration <= maxDuration) {
        includedScenarios.push(scenario);
        totalDuration += scenario.estimatedDuration;
      } else {
        excludedScenarios.push(scenario);
      }
    }
  } else {
    includedScenarios = filteredScenarios;
    totalDuration = filteredScenarios.reduce((sum, s) => sum + s.estimatedDuration, 0);
  }

  // Calculate coverage
  const coverage = calculateCoverage(includedScenarios, appStructure);

  // Create plan
  const plan: TestPlan = {
    id: uuidv4(),
    name,
    description: description || generatePlanDescription(includedScenarios, appStructure),
    scenarios: includedScenarios,
    coverage,
    schedule,
    createdAt: new Date().toISOString(),
  };

  // Save plan
  saveTestPlan(plan, appStructure.projectPath);

  return {
    plan,
    excludedScenarios,
    estimatedDuration: totalDuration,
    summary: generatePlanSummary(plan, excludedScenarios, totalDuration),
  };
}

function calculateCoverage(scenarios: TestScenario[], app: AppStructure): CoverageInfo {
  const coveredScreens = new Set<string>();
  const coveredComponents = new Set<string>();
  const coveredApis = new Set<string>();
  let edgeCases = 0;
  let stateTransitions = 0;

  for (const scenario of scenarios) {
    // Count edge cases
    if (scenario.tags.includes('edge-case') || scenario.tags.includes('error-handling')) {
      edgeCases++;
    }

    // Count state transitions
    if (scenario.tags.includes('state') || scenario.tags.includes('state-management')) {
      stateTransitions++;
    }

    // Track covered screens
    for (const step of scenario.steps) {
      if (step.target) {
        const matchingScreen = app.screens.find(s =>
          s.name.toLowerCase().includes(step.target!.toLowerCase())
        );
        if (matchingScreen) {
          coveredScreens.add(matchingScreen.name);
        }
      }
    }

    // Track covered components from tags
    for (const tag of scenario.tags) {
      const matchingComponent = app.components.find(c =>
        c.name.toLowerCase() === tag.toLowerCase()
      );
      if (matchingComponent) {
        coveredComponents.add(matchingComponent.name);
      }
    }

    // Track covered APIs
    if (scenario.tags.includes('api')) {
      for (const step of scenario.steps) {
        if (step.target && step.target.includes('/')) {
          coveredApis.add(step.target);
        }
      }
    }
  }

  return {
    screens: Math.round((coveredScreens.size / Math.max(app.screens.length, 1)) * 100),
    components: Math.round((coveredComponents.size / Math.max(app.components.length, 1)) * 100),
    apis: Math.round((coveredApis.size / Math.max(app.apis.length, 1)) * 100),
    stateTransitions,
    edgeCases,
  };
}

function generatePlanDescription(scenarios: TestScenario[], app: AppStructure): string {
  const types = [...new Set(scenarios.map(s => s.type))];
  return `Test plan covering ${types.join(', ')} tests for ${app.platform} application with ${app.screens.length} screens and ${app.components.length} components.`;
}

function generatePlanSummary(
  plan: TestPlan,
  excludedScenarios: TestScenario[],
  totalDuration: number
): string {
  const lines: string[] = [];

  lines.push(`Test Plan: ${plan.name}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Total Scenarios: ${plan.scenarios.length}`);

  // By type
  const byType: Record<string, number> = {};
  for (const s of plan.scenarios) {
    byType[s.type] = (byType[s.type] || 0) + 1;
  }
  lines.push(`\nBy Type:`);
  for (const [type, count] of Object.entries(byType)) {
    lines.push(`  - ${type}: ${count}`);
  }

  // By priority
  const byPriority: Record<string, number> = {};
  for (const s of plan.scenarios) {
    byPriority[s.priority] = (byPriority[s.priority] || 0) + 1;
  }
  lines.push(`\nBy Priority:`);
  for (const [priority, count] of Object.entries(byPriority)) {
    lines.push(`  - ${priority}: ${count}`);
  }

  // Coverage
  lines.push(`\nCoverage:`);
  lines.push(`  - Screens: ${plan.coverage.screens}%`);
  lines.push(`  - Components: ${plan.coverage.components}%`);
  lines.push(`  - APIs: ${plan.coverage.apis}%`);
  lines.push(`  - Edge Cases: ${plan.coverage.edgeCases}`);

  // Duration
  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);
  const seconds = totalDuration % 60;
  lines.push(`\nEstimated Duration: ${hours}h ${minutes}m ${seconds}s`);

  // Excluded
  if (excludedScenarios.length > 0) {
    lines.push(`\nExcluded Scenarios: ${excludedScenarios.length} (due to time limit)`);
  }

  // Schedule
  if (plan.schedule) {
    lines.push(`\nSchedule: ${plan.schedule.type}`);
    if (plan.schedule.nextRun) {
      lines.push(`Next Run: ${plan.schedule.nextRun}`);
    }
  }

  return lines.join('\n');
}

// Quick plan templates
export function createQuickPlan(
  appStructure: AppStructure,
  scenarios: TestScenario[],
  template: 'smoke' | 'regression' | 'nightly' | 'full'
): CreateTestPlanResult {
  switch (template) {
    case 'smoke':
      return createTestPlan({
        name: 'Smoke Test',
        description: 'Quick smoke test covering critical functionality',
        scenarios,
        appStructure,
        priorityFilter: ['critical', 'high'],
        typeFilter: ['e2e'],
        maxDuration: 300, // 5 minutes
      });

    case 'regression':
      return createTestPlan({
        name: 'Regression Test',
        description: 'Comprehensive regression test suite',
        scenarios,
        appStructure,
        priorityFilter: ['critical', 'high', 'medium'],
        maxDuration: 3600, // 1 hour
      });

    case 'nightly':
      return createTestPlan({
        name: 'Nightly Test',
        description: 'Full nightly test including performance and memory tests',
        scenarios,
        appStructure,
        schedule: { type: 'daily', nextRun: getNextNightlyRun() },
      });

    case 'full':
    default:
      return createTestPlan({
        name: 'Full Test Suite',
        description: 'Complete test suite covering all scenarios',
        scenarios,
        appStructure,
      });
  }
}

function getNextNightlyRun(): string {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0); // 2 AM
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

export default createTestPlan;
