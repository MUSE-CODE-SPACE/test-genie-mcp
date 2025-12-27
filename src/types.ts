// ============================================
// Test Genie MCP - Type Definitions
// ============================================

// Platform Types
export type Platform = 'ios' | 'android' | 'flutter' | 'react-native' | 'web';
export type Language = 'swift' | 'kotlin' | 'java' | 'dart' | 'typescript' | 'javascript';

// Test Types
export type TestType = 'unit' | 'integration' | 'e2e' | 'performance' | 'stress' | 'memory';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FixStatus = 'pending' | 'confirmed' | 'rejected' | 'applied' | 'failed';

// ============================================
// App Analysis
// ============================================
export interface AppStructure {
  projectPath: string;
  platform: Platform;
  language: Language;
  screens: ScreenInfo[];
  components: ComponentInfo[];
  apis: ApiInfo[];
  stateManagement: StateManagementInfo | null;
  dependencies: DependencyInfo[];
  analyzedAt: string;
}

export interface ScreenInfo {
  name: string;
  path: string;
  type: 'screen' | 'page' | 'view' | 'activity' | 'fragment';
  components: string[];
  navigation: NavigationInfo[];
  stateUsage: string[];
}

export interface ComponentInfo {
  name: string;
  path: string;
  type: 'component' | 'widget' | 'view' | 'cell';
  props: PropInfo[];
  state: StateInfo[];
  lifecycle: LifecycleInfo[];
  dependencies: string[];
}

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface StateInfo {
  name: string;
  type: string;
  initialValue?: string;
}

export interface LifecycleInfo {
  method: string;
  hasCleanup: boolean;
  subscriptions: string[];
}

export interface NavigationInfo {
  target: string;
  type: 'push' | 'pop' | 'replace' | 'modal' | 'tab';
  params?: string[];
}

export interface ApiInfo {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  requestType?: string;
  responseType?: string;
  errorHandling: boolean;
}

export interface StateManagementInfo {
  type: 'redux' | 'mobx' | 'zustand' | 'recoil' | 'provider' | 'bloc' | 'riverpod' | 'getx' | 'other';
  stores: string[];
  actions: string[];
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'production' | 'development';
}

// ============================================
// Test Scenarios
// ============================================
export interface TestScenario {
  id: string;
  name: string;
  description: string;
  type: TestType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  steps: TestStep[];
  preconditions: string[];
  expectedResults: string[];
  tags: string[];
  estimatedDuration: number; // in seconds
  createdAt: string;
}

export interface TestStep {
  order: number;
  action: string;
  target?: string;
  input?: string;
  expectedOutput?: string;
  timeout?: number;
}

export interface TestPlan {
  id: string;
  name: string;
  description: string;
  scenarios: TestScenario[];
  coverage: CoverageInfo;
  schedule?: ScheduleInfo;
  createdAt: string;
}

export interface CoverageInfo {
  screens: number;
  components: number;
  apis: number;
  stateTransitions: number;
  edgeCases: number;
}

export interface ScheduleInfo {
  type: 'once' | 'daily' | 'weekly' | 'on-commit';
  nextRun?: string;
}

// ============================================
// Test Execution
// ============================================
export interface TestResult {
  id: string;
  scenarioId: string;
  scenarioName: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  duration: number; // in ms
  steps: StepResult[];
  logs: string[];
  screenshots?: string[];
  error?: ErrorInfo;
  executedAt: string;
}

export interface StepResult {
  order: number;
  action: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  actualOutput?: string;
  error?: string;
}

export interface ErrorInfo {
  type: string;
  message: string;
  stackTrace?: string;
  file?: string;
  line?: number;
}

export interface SimulationResult {
  id: string;
  duration: number;
  userActions: number;
  errorsFound: number;
  memoryPeakMB: number;
  cpuPeakPercent: number;
  crashes: CrashInfo[];
  anomalies: AnomalyInfo[];
  executedAt: string;
}

export interface CrashInfo {
  timestamp: string;
  type: string;
  message: string;
  stackTrace: string;
  screen?: string;
}

export interface AnomalyInfo {
  type: 'memory_spike' | 'cpu_spike' | 'slow_render' | 'network_timeout' | 'state_inconsistency';
  timestamp: string;
  details: string;
  severity: Severity;
}

// ============================================
// Issue Detection
// ============================================
export interface DetectedIssue {
  id: string;
  type: IssueType;
  severity: Severity;
  title: string;
  description: string;
  file: string;
  line: number;
  column?: number;
  code?: string;
  suggestion?: string;
  relatedIssues?: string[];
  detectedAt: string;
}

export type IssueType =
  | 'memory_leak'
  | 'retain_cycle'
  | 'unclosed_resource'
  | 'race_condition'
  | 'state_inconsistency'
  | 'null_reference'
  | 'type_mismatch'
  | 'unhandled_error'
  | 'performance_bottleneck'
  | 'unused_code'
  | 'deprecated_api'
  | 'security_vulnerability';

export interface MemoryLeakInfo extends DetectedIssue {
  type: 'memory_leak' | 'retain_cycle' | 'unclosed_resource';
  objectType: string;
  retainCount?: number;
  allocationSize?: number;
  retainCycle?: string[];
}

export interface LogicErrorInfo extends DetectedIssue {
  type: 'race_condition' | 'state_inconsistency' | 'null_reference' | 'type_mismatch';
  context: string;
  possibleCause: string;
  reproducibility: 'always' | 'intermittent' | 'rare';
}

export interface PerformanceIssue extends DetectedIssue {
  type: 'performance_bottleneck';
  metric: 'cpu' | 'memory' | 'render' | 'network' | 'disk';
  currentValue: number;
  threshold: number;
  unit: string;
}

// ============================================
// Fix Suggestions
// ============================================
export interface FixSuggestion {
  id: string;
  issueId: string;
  title: string;
  description: string;
  confidence: number; // 0-100
  file: string;
  line: number;
  originalCode: string;
  suggestedCode: string;
  diff: string;
  impact: ImpactInfo;
  alternatives?: AlternativeFix[];
  status: FixStatus;
  createdAt: string;
  confirmedAt?: string;
  appliedAt?: string;
}

export interface ImpactInfo {
  filesAffected: string[];
  testsAffected: string[];
  riskLevel: 'low' | 'medium' | 'high';
  breakingChange: boolean;
  requiresRetest: boolean;
}

export interface AlternativeFix {
  description: string;
  suggestedCode: string;
  diff: string;
  tradeoffs: string;
}

export interface FixConfirmation {
  fixId: string;
  action: 'approve' | 'reject' | 'modify';
  modifiedCode?: string;
  reason?: string;
  confirmedAt: string;
}

export interface FixApplication {
  fixId: string;
  success: boolean;
  backupPath?: string;
  error?: string;
  retestResult?: TestResult;
  appliedAt: string;
}

// ============================================
// Automation
// ============================================
export interface AutomationConfig {
  projectPath: string;
  platform: Platform;
  testTypes: TestType[];
  autoFix: boolean;
  confirmMode: 'auto' | 'interactive' | 'batch';
  thresholds: ThresholdConfig;
  notifications?: NotificationConfig;
}

export interface ThresholdConfig {
  memoryLeakSizeMB: number;
  cpuUsagePercent: number;
  renderTimeMs: number;
  apiTimeoutMs: number;
  coveragePercent: number;
}

export interface NotificationConfig {
  onComplete: boolean;
  onCriticalIssue: boolean;
  channels: ('slack' | 'email' | 'discord')[];
}

export interface AutomationResult {
  id: string;
  config: AutomationConfig;
  appStructure: AppStructure;
  testPlan: TestPlan;
  testResults: TestResult[];
  simulationResult?: SimulationResult;
  detectedIssues: DetectedIssue[];
  fixSuggestions: FixSuggestion[];
  appliedFixes: FixApplication[];
  summary: AutomationSummary;
  startedAt: string;
  completedAt: string;
}

export interface AutomationSummary {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  totalIssues: number;
  criticalIssues: number;
  fixesApplied: number;
  coveragePercent: number;
  duration: number;
}

// ============================================
// Report
// ============================================
export interface TestReport {
  id: string;
  title: string;
  format: 'markdown' | 'html' | 'json';
  sections: ReportSection[];
  generatedAt: string;
}

export interface ReportSection {
  title: string;
  type: 'summary' | 'details' | 'issues' | 'fixes' | 'recommendations';
  content: string;
}

// ============================================
// Storage
// ============================================
export interface StoredScenario {
  scenario: TestScenario;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTestResult {
  result: TestResult;
  projectPath: string;
  createdAt: string;
}

export interface StoredFix {
  fix: FixSuggestion;
  confirmation?: FixConfirmation;
  application?: FixApplication;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
}
