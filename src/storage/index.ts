// ============================================
// Storage Module for Test Genie MCP
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import {
  TestScenario,
  TestPlan,
  TestResult,
  DetectedIssue,
  FixSuggestion,
  FixConfirmation,
  FixApplication,
  StoredScenario,
  StoredTestResult,
  StoredFix,
} from '../types.js';

const STORAGE_DIR = path.join(process.env.HOME || '~', '.test-genie-mcp');
const SCENARIOS_FILE = path.join(STORAGE_DIR, 'scenarios.json');
const RESULTS_FILE = path.join(STORAGE_DIR, 'results.json');
const FIXES_FILE = path.join(STORAGE_DIR, 'fixes.json');
const PLANS_FILE = path.join(STORAGE_DIR, 'plans.json');
const ISSUES_FILE = path.join(STORAGE_DIR, 'issues.json');

// Ensure storage directory exists
function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

// Generic JSON read/write
function readJson<T>(filePath: string, defaultValue: T): T {
  ensureStorageDir();
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

function writeJson<T>(filePath: string, data: T): void {
  ensureStorageDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// Scenario Storage
// ============================================
export function saveScenario(scenario: TestScenario, projectPath: string): void {
  const scenarios = readJson<StoredScenario[]>(SCENARIOS_FILE, []);
  const existing = scenarios.findIndex(
    s => s.scenario.id === scenario.id && s.projectPath === projectPath
  );

  const stored: StoredScenario = {
    scenario,
    projectPath,
    createdAt: existing >= 0 ? scenarios[existing]!.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    scenarios[existing] = stored;
  } else {
    scenarios.push(stored);
  }

  writeJson(SCENARIOS_FILE, scenarios);
}

export function getScenarios(projectPath?: string): StoredScenario[] {
  const scenarios = readJson<StoredScenario[]>(SCENARIOS_FILE, []);
  if (projectPath) {
    return scenarios.filter(s => s.projectPath === projectPath);
  }
  return scenarios;
}

export function getScenarioById(id: string): StoredScenario | undefined {
  const scenarios = readJson<StoredScenario[]>(SCENARIOS_FILE, []);
  return scenarios.find(s => s.scenario.id === id);
}

export function deleteScenario(id: string): boolean {
  const scenarios = readJson<StoredScenario[]>(SCENARIOS_FILE, []);
  const filtered = scenarios.filter(s => s.scenario.id !== id);
  if (filtered.length < scenarios.length) {
    writeJson(SCENARIOS_FILE, filtered);
    return true;
  }
  return false;
}

// ============================================
// Test Plan Storage
// ============================================
export function saveTestPlan(plan: TestPlan, projectPath: string): void {
  const plans = readJson<{ plan: TestPlan; projectPath: string; createdAt: string }[]>(PLANS_FILE, []);
  const existing = plans.findIndex(p => p.plan.id === plan.id);

  const stored = {
    plan,
    projectPath,
    createdAt: existing >= 0 ? plans[existing]!.createdAt : new Date().toISOString(),
  };

  if (existing >= 0) {
    plans[existing] = stored;
  } else {
    plans.push(stored);
  }

  writeJson(PLANS_FILE, plans);
}

export function getTestPlans(projectPath?: string): TestPlan[] {
  const plans = readJson<{ plan: TestPlan; projectPath: string }[]>(PLANS_FILE, []);
  if (projectPath) {
    return plans.filter(p => p.projectPath === projectPath).map(p => p.plan);
  }
  return plans.map(p => p.plan);
}

export function getTestPlanById(id: string): TestPlan | undefined {
  const plans = readJson<{ plan: TestPlan }[]>(PLANS_FILE, []);
  return plans.find(p => p.plan.id === id)?.plan;
}

// ============================================
// Test Result Storage
// ============================================
export function saveTestResult(result: TestResult, projectPath: string): void {
  const results = readJson<StoredTestResult[]>(RESULTS_FILE, []);

  results.push({
    result,
    projectPath,
    createdAt: new Date().toISOString(),
  });

  // Keep only last 1000 results
  if (results.length > 1000) {
    results.splice(0, results.length - 1000);
  }

  writeJson(RESULTS_FILE, results);
}

export function getTestResults(projectPath?: string, limit = 100): StoredTestResult[] {
  const results = readJson<StoredTestResult[]>(RESULTS_FILE, []);
  let filtered = projectPath ? results.filter(r => r.projectPath === projectPath) : results;
  return filtered.slice(-limit);
}

export function getTestResultsByScenario(scenarioId: string): TestResult[] {
  const results = readJson<StoredTestResult[]>(RESULTS_FILE, []);
  return results.filter(r => r.result.scenarioId === scenarioId).map(r => r.result);
}

// ============================================
// Detected Issues Storage
// ============================================
export function saveIssue(issue: DetectedIssue, projectPath: string): void {
  const issues = readJson<{ issue: DetectedIssue; projectPath: string; createdAt: string }[]>(ISSUES_FILE, []);
  const existing = issues.findIndex(i => i.issue.id === issue.id);

  const stored = {
    issue,
    projectPath,
    createdAt: existing >= 0 ? issues[existing]!.createdAt : new Date().toISOString(),
  };

  if (existing >= 0) {
    issues[existing] = stored;
  } else {
    issues.push(stored);
  }

  writeJson(ISSUES_FILE, issues);
}

export function saveIssues(issueList: DetectedIssue[], projectPath: string): void {
  for (const issue of issueList) {
    saveIssue(issue, projectPath);
  }
}

export function getIssues(projectPath?: string): DetectedIssue[] {
  const issues = readJson<{ issue: DetectedIssue; projectPath: string }[]>(ISSUES_FILE, []);
  if (projectPath) {
    return issues.filter(i => i.projectPath === projectPath).map(i => i.issue);
  }
  return issues.map(i => i.issue);
}

export function getIssueById(id: string): DetectedIssue | undefined {
  const issues = readJson<{ issue: DetectedIssue }[]>(ISSUES_FILE, []);
  return issues.find(i => i.issue.id === id)?.issue;
}

export function deleteIssue(id: string): boolean {
  const issues = readJson<{ issue: DetectedIssue; projectPath: string; createdAt: string }[]>(ISSUES_FILE, []);
  const filtered = issues.filter(i => i.issue.id !== id);
  if (filtered.length < issues.length) {
    writeJson(ISSUES_FILE, filtered);
    return true;
  }
  return false;
}

// ============================================
// Fix Storage
// ============================================
export function saveFix(fix: FixSuggestion, projectPath: string): void {
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  const existing = fixes.findIndex(f => f.fix.id === fix.id);

  const stored: StoredFix = {
    fix,
    projectPath,
    createdAt: existing >= 0 ? fixes[existing]!.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    stored.confirmation = fixes[existing]!.confirmation;
    stored.application = fixes[existing]!.application;
    fixes[existing] = stored;
  } else {
    fixes.push(stored);
  }

  writeJson(FIXES_FILE, fixes);
}

export function saveFixes(fixList: FixSuggestion[], projectPath: string): void {
  for (const fix of fixList) {
    saveFix(fix, projectPath);
  }
}

export function getFixes(projectPath?: string): StoredFix[] {
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  if (projectPath) {
    return fixes.filter(f => f.projectPath === projectPath);
  }
  return fixes;
}

export function getFixById(id: string): StoredFix | undefined {
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  return fixes.find(f => f.fix.id === id);
}

export function updateFixConfirmation(fixId: string, confirmation: FixConfirmation): boolean {
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  const fix = fixes.find(f => f.fix.id === fixId);
  if (fix) {
    fix.confirmation = confirmation;
    fix.fix.status = confirmation.action === 'approve' ? 'confirmed' : 'rejected';
    fix.fix.confirmedAt = confirmation.confirmedAt;
    fix.updatedAt = new Date().toISOString();
    writeJson(FIXES_FILE, fixes);
    return true;
  }
  return false;
}

export function updateFixApplication(fixId: string, application: FixApplication): boolean {
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  const fix = fixes.find(f => f.fix.id === fixId);
  if (fix) {
    fix.application = application;
    fix.fix.status = application.success ? 'applied' : 'failed';
    fix.fix.appliedAt = application.appliedAt;
    fix.updatedAt = new Date().toISOString();
    writeJson(FIXES_FILE, fixes);
    return true;
  }
  return false;
}

export function getPendingFixes(projectPath?: string): StoredFix[] {
  return getFixes(projectPath).filter(f => f.fix.status === 'pending');
}

export function getConfirmedFixes(projectPath?: string): StoredFix[] {
  return getFixes(projectPath).filter(f => f.fix.status === 'confirmed');
}

// ============================================
// Stats
// ============================================
export function getStats(projectPath?: string): {
  totalScenarios: number;
  totalResults: number;
  totalIssues: number;
  totalFixes: number;
  pendingFixes: number;
  appliedFixes: number;
} {
  return {
    totalScenarios: getScenarios(projectPath).length,
    totalResults: getTestResults(projectPath).length,
    totalIssues: getIssues(projectPath).length,
    totalFixes: getFixes(projectPath).length,
    pendingFixes: getPendingFixes(projectPath).length,
    appliedFixes: getFixes(projectPath).filter(f => f.fix.status === 'applied').length,
  };
}

// ============================================
// Clear Storage
// ============================================
export function clearAll(): void {
  if (fs.existsSync(SCENARIOS_FILE)) fs.unlinkSync(SCENARIOS_FILE);
  if (fs.existsSync(RESULTS_FILE)) fs.unlinkSync(RESULTS_FILE);
  if (fs.existsSync(FIXES_FILE)) fs.unlinkSync(FIXES_FILE);
  if (fs.existsSync(PLANS_FILE)) fs.unlinkSync(PLANS_FILE);
  if (fs.existsSync(ISSUES_FILE)) fs.unlinkSync(ISSUES_FILE);
}

export function clearProject(projectPath: string): void {
  // Scenarios
  const scenarios = readJson<StoredScenario[]>(SCENARIOS_FILE, []);
  writeJson(SCENARIOS_FILE, scenarios.filter(s => s.projectPath !== projectPath));

  // Results
  const results = readJson<StoredTestResult[]>(RESULTS_FILE, []);
  writeJson(RESULTS_FILE, results.filter(r => r.projectPath !== projectPath));

  // Issues
  const issues = readJson<{ issue: DetectedIssue; projectPath: string; createdAt: string }[]>(ISSUES_FILE, []);
  writeJson(ISSUES_FILE, issues.filter(i => i.projectPath !== projectPath));

  // Fixes
  const fixes = readJson<StoredFix[]>(FIXES_FILE, []);
  writeJson(FIXES_FILE, fixes.filter(f => f.projectPath !== projectPath));

  // Plans
  const plans = readJson<{ plan: TestPlan; projectPath: string }[]>(PLANS_FILE, []);
  writeJson(PLANS_FILE, plans.filter(p => p.projectPath !== projectPath));
}
