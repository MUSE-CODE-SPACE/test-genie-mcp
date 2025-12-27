// ============================================
// Generate Test Scenarios Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import {
  AppStructure,
  TestScenario,
  TestStep,
  TestType,
  ScreenInfo,
  ComponentInfo,
  ApiInfo,
} from '../../types.js';
import { saveScenario } from '../../storage/index.js';

interface GenerateScenariosParams {
  appStructure: AppStructure;
  testTypes?: TestType[];
  coverage?: 'minimal' | 'standard' | 'comprehensive';
  focusAreas?: string[];
  maxScenarios?: number;
}

interface GenerateScenariosResult {
  scenarios: TestScenario[];
  coverage: {
    screens: number;
    components: number;
    apis: number;
    edgeCases: number;
  };
  summary: string;
}

export function generateScenarios(params: GenerateScenariosParams): GenerateScenariosResult {
  const {
    appStructure,
    testTypes = ['unit', 'integration', 'e2e'],
    coverage = 'standard',
    focusAreas = [],
    maxScenarios = 100,
  } = params;

  const scenarios: TestScenario[] = [];

  // Generate scenarios based on test types
  if (testTypes.includes('e2e')) {
    scenarios.push(...generateE2EScenarios(appStructure, coverage));
  }

  if (testTypes.includes('integration')) {
    scenarios.push(...generateIntegrationScenarios(appStructure, coverage));
  }

  if (testTypes.includes('unit')) {
    scenarios.push(...generateUnitScenarios(appStructure, coverage));
  }

  if (testTypes.includes('performance')) {
    scenarios.push(...generatePerformanceScenarios(appStructure));
  }

  if (testTypes.includes('memory')) {
    scenarios.push(...generateMemoryScenarios(appStructure));
  }

  // Filter by focus areas if specified
  let filteredScenarios = scenarios;
  if (focusAreas.length > 0) {
    filteredScenarios = scenarios.filter(s =>
      focusAreas.some(area =>
        s.name.toLowerCase().includes(area.toLowerCase()) ||
        s.tags.some(tag => tag.toLowerCase().includes(area.toLowerCase()))
      )
    );
  }

  // Limit scenarios
  const finalScenarios = filteredScenarios.slice(0, maxScenarios);

  // Save scenarios
  for (const scenario of finalScenarios) {
    saveScenario(scenario, appStructure.projectPath);
  }

  return {
    scenarios: finalScenarios,
    coverage: {
      screens: countCoveredScreens(finalScenarios, appStructure),
      components: countCoveredComponents(finalScenarios, appStructure),
      apis: countCoveredApis(finalScenarios, appStructure),
      edgeCases: finalScenarios.filter(s => s.tags.includes('edge-case')).length,
    },
    summary: generateSummary(finalScenarios, appStructure),
  };
}

// ============================================
// E2E Scenario Generation
// ============================================
function generateE2EScenarios(app: AppStructure, coverage: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Happy path scenarios for each screen
  for (const screen of app.screens) {
    scenarios.push(createHappyPathScenario(screen, app));

    // Navigation scenarios
    for (const nav of screen.navigation) {
      scenarios.push(createNavigationScenario(screen, nav, app));
    }

    // Edge cases
    if (coverage === 'comprehensive') {
      scenarios.push(...createEdgeCaseScenarios(screen, app));
    }
  }

  // User flow scenarios
  scenarios.push(...generateUserFlowScenarios(app, coverage));

  return scenarios;
}

function createHappyPathScenario(screen: ScreenInfo, app: AppStructure): TestScenario {
  const steps: TestStep[] = [
    {
      order: 1,
      action: 'navigate',
      target: screen.name,
      expectedOutput: `${screen.name} is displayed`,
    },
    {
      order: 2,
      action: 'verify',
      target: 'screen',
      expectedOutput: 'All UI elements are visible',
    },
  ];

  // Add interaction steps based on components
  let stepOrder = 3;
  for (const component of screen.components.slice(0, 5)) {
    steps.push({
      order: stepOrder++,
      action: 'interact',
      target: component,
      expectedOutput: 'Component responds correctly',
    });
  }

  return {
    id: uuidv4(),
    name: `[E2E] ${screen.name} - Happy Path`,
    description: `Verify ${screen.name} displays correctly and basic interactions work`,
    type: 'e2e',
    priority: 'high',
    steps,
    preconditions: ['App is launched', 'User is authenticated'],
    expectedResults: ['Screen loads successfully', 'All elements are interactive'],
    tags: ['e2e', 'happy-path', screen.name.toLowerCase()],
    estimatedDuration: 30,
    createdAt: new Date().toISOString(),
  };
}

function createNavigationScenario(screen: ScreenInfo, nav: { target: string; type: string }, app: AppStructure): TestScenario {
  return {
    id: uuidv4(),
    name: `[E2E] Navigation: ${screen.name} → ${nav.target}`,
    description: `Verify navigation from ${screen.name} to ${nav.target}`,
    type: 'e2e',
    priority: 'medium',
    steps: [
      { order: 1, action: 'navigate', target: screen.name, expectedOutput: `${screen.name} is displayed` },
      { order: 2, action: 'tap', target: `navigate_to_${nav.target}`, expectedOutput: 'Navigation triggered' },
      { order: 3, action: 'verify', target: nav.target, expectedOutput: `${nav.target} is displayed` },
    ],
    preconditions: ['App is launched', `${screen.name} is accessible`],
    expectedResults: [`Successfully navigated to ${nav.target}`],
    tags: ['e2e', 'navigation', screen.name.toLowerCase(), nav.target.toLowerCase()],
    estimatedDuration: 15,
    createdAt: new Date().toISOString(),
  };
}

function createEdgeCaseScenarios(screen: ScreenInfo, app: AppStructure): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Empty state
  scenarios.push({
    id: uuidv4(),
    name: `[E2E] ${screen.name} - Empty State`,
    description: `Verify ${screen.name} handles empty data gracefully`,
    type: 'e2e',
    priority: 'medium',
    steps: [
      { order: 1, action: 'mock', target: 'api', input: 'empty_response' },
      { order: 2, action: 'navigate', target: screen.name },
      { order: 3, action: 'verify', target: 'empty_state', expectedOutput: 'Empty state message displayed' },
    ],
    preconditions: ['App is launched', 'API returns empty data'],
    expectedResults: ['Empty state is displayed correctly'],
    tags: ['e2e', 'edge-case', 'empty-state', screen.name.toLowerCase()],
    estimatedDuration: 20,
    createdAt: new Date().toISOString(),
  });

  // Error state
  scenarios.push({
    id: uuidv4(),
    name: `[E2E] ${screen.name} - Error Handling`,
    description: `Verify ${screen.name} handles API errors gracefully`,
    type: 'e2e',
    priority: 'high',
    steps: [
      { order: 1, action: 'mock', target: 'api', input: 'error_500' },
      { order: 2, action: 'navigate', target: screen.name },
      { order: 3, action: 'verify', target: 'error_state', expectedOutput: 'Error message displayed' },
      { order: 4, action: 'tap', target: 'retry_button', expectedOutput: 'Retry triggered' },
    ],
    preconditions: ['App is launched', 'API returns error'],
    expectedResults: ['Error state is displayed', 'Retry works correctly'],
    tags: ['e2e', 'edge-case', 'error-handling', screen.name.toLowerCase()],
    estimatedDuration: 25,
    createdAt: new Date().toISOString(),
  });

  // Network offline
  scenarios.push({
    id: uuidv4(),
    name: `[E2E] ${screen.name} - Offline Mode`,
    description: `Verify ${screen.name} handles offline state`,
    type: 'e2e',
    priority: 'medium',
    steps: [
      { order: 1, action: 'set_network', target: 'offline' },
      { order: 2, action: 'navigate', target: screen.name },
      { order: 3, action: 'verify', target: 'offline_indicator', expectedOutput: 'Offline message shown' },
    ],
    preconditions: ['App is launched', 'Network is disabled'],
    expectedResults: ['Offline state is handled gracefully'],
    tags: ['e2e', 'edge-case', 'offline', screen.name.toLowerCase()],
    estimatedDuration: 20,
    createdAt: new Date().toISOString(),
  });

  return scenarios;
}

function generateUserFlowScenarios(app: AppStructure, coverage: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Common user flows based on app structure
  const flows = detectUserFlows(app);

  for (const flow of flows) {
    const steps: TestStep[] = flow.screens.map((screen, index) => ({
      order: index + 1,
      action: index === 0 ? 'navigate' : 'tap',
      target: screen,
      expectedOutput: `${screen} is displayed`,
    }));

    scenarios.push({
      id: uuidv4(),
      name: `[E2E] User Flow: ${flow.name}`,
      description: flow.description,
      type: 'e2e',
      priority: 'high',
      steps,
      preconditions: flow.preconditions,
      expectedResults: flow.expectedResults,
      tags: ['e2e', 'user-flow', ...flow.tags],
      estimatedDuration: flow.screens.length * 10,
      createdAt: new Date().toISOString(),
    });
  }

  return scenarios;
}

function detectUserFlows(app: AppStructure): Array<{
  name: string;
  description: string;
  screens: string[];
  preconditions: string[];
  expectedResults: string[];
  tags: string[];
}> {
  const flows = [];
  const screenNames = app.screens.map(s => s.name.toLowerCase());

  // Login flow
  if (screenNames.some(s => s.includes('login') || s.includes('signin'))) {
    flows.push({
      name: 'Login Flow',
      description: 'Complete user login process',
      screens: ['Login', 'Home'],
      preconditions: ['App is launched', 'User has valid credentials'],
      expectedResults: ['User is logged in', 'Home screen is displayed'],
      tags: ['auth', 'login'],
    });
  }

  // Registration flow
  if (screenNames.some(s => s.includes('register') || s.includes('signup'))) {
    flows.push({
      name: 'Registration Flow',
      description: 'Complete user registration process',
      screens: ['Register', 'Verification', 'Home'],
      preconditions: ['App is launched', 'User has valid email'],
      expectedResults: ['Account is created', 'User is logged in'],
      tags: ['auth', 'registration'],
    });
  }

  // Onboarding flow
  if (screenNames.some(s => s.includes('onboarding') || s.includes('tutorial'))) {
    flows.push({
      name: 'Onboarding Flow',
      description: 'Complete onboarding tutorial',
      screens: ['Onboarding1', 'Onboarding2', 'Onboarding3', 'Home'],
      preconditions: ['First app launch'],
      expectedResults: ['Onboarding completed', 'Main screen displayed'],
      tags: ['onboarding'],
    });
  }

  // Settings flow
  if (screenNames.some(s => s.includes('settings') || s.includes('profile'))) {
    flows.push({
      name: 'Settings Update Flow',
      description: 'Update user settings',
      screens: ['Home', 'Settings', 'Edit', 'Settings'],
      preconditions: ['User is logged in'],
      expectedResults: ['Settings updated successfully'],
      tags: ['settings', 'profile'],
    });
  }

  return flows;
}

// ============================================
// Integration Scenario Generation
// ============================================
function generateIntegrationScenarios(app: AppStructure, coverage: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // API integration scenarios
  for (const api of app.apis) {
    scenarios.push({
      id: uuidv4(),
      name: `[Integration] API: ${api.method} ${api.endpoint}`,
      description: `Test ${api.method} ${api.endpoint} integration`,
      type: 'integration',
      priority: 'high',
      steps: [
        { order: 1, action: 'prepare', target: 'request', input: JSON.stringify({ method: api.method, endpoint: api.endpoint }) },
        { order: 2, action: 'execute', target: 'api_call', expectedOutput: 'Response received' },
        { order: 3, action: 'verify', target: 'response', expectedOutput: 'Valid response structure' },
      ],
      preconditions: ['API server is running', 'Valid authentication token'],
      expectedResults: ['API returns valid response', 'Response matches expected schema'],
      tags: ['integration', 'api', api.method.toLowerCase()],
      estimatedDuration: 10,
      createdAt: new Date().toISOString(),
    });

    // Error handling for API
    if (coverage === 'comprehensive') {
      scenarios.push({
        id: uuidv4(),
        name: `[Integration] API Error: ${api.method} ${api.endpoint}`,
        description: `Test error handling for ${api.method} ${api.endpoint}`,
        type: 'integration',
        priority: 'medium',
        steps: [
          { order: 1, action: 'mock', target: 'api', input: 'error_response' },
          { order: 2, action: 'execute', target: 'api_call' },
          { order: 3, action: 'verify', target: 'error_handling', expectedOutput: 'Error handled gracefully' },
        ],
        preconditions: ['API mocked to return error'],
        expectedResults: ['Error is caught', 'User-friendly message displayed'],
        tags: ['integration', 'api', 'error-handling'],
        estimatedDuration: 10,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // State management integration
  if (app.stateManagement) {
    scenarios.push({
      id: uuidv4(),
      name: `[Integration] State Management: ${app.stateManagement.type}`,
      description: `Test ${app.stateManagement.type} state synchronization`,
      type: 'integration',
      priority: 'high',
      steps: [
        { order: 1, action: 'dispatch', target: 'action', input: 'test_action' },
        { order: 2, action: 'verify', target: 'state', expectedOutput: 'State updated correctly' },
        { order: 3, action: 'verify', target: 'ui', expectedOutput: 'UI reflects state change' },
      ],
      preconditions: ['Store is initialized'],
      expectedResults: ['State updates propagate correctly', 'UI reflects state changes'],
      tags: ['integration', 'state-management', app.stateManagement.type],
      estimatedDuration: 15,
      createdAt: new Date().toISOString(),
    });
  }

  return scenarios;
}

// ============================================
// Unit Scenario Generation
// ============================================
function generateUnitScenarios(app: AppStructure, coverage: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Component unit tests
  for (const component of app.components.slice(0, 20)) {
    // Props validation
    if (component.props.length > 0) {
      scenarios.push({
        id: uuidv4(),
        name: `[Unit] ${component.name} - Props Validation`,
        description: `Test ${component.name} with various prop combinations`,
        type: 'unit',
        priority: 'medium',
        steps: [
          { order: 1, action: 'render', target: component.name, input: 'valid_props' },
          { order: 2, action: 'verify', target: 'rendered', expectedOutput: 'Component rendered' },
        ],
        preconditions: ['Component imported'],
        expectedResults: ['Component renders with valid props', 'PropTypes/TypeScript validation passes'],
        tags: ['unit', 'component', component.name.toLowerCase()],
        estimatedDuration: 5,
        createdAt: new Date().toISOString(),
      });
    }

    // State changes
    if (component.state.length > 0) {
      scenarios.push({
        id: uuidv4(),
        name: `[Unit] ${component.name} - State Changes`,
        description: `Test ${component.name} state transitions`,
        type: 'unit',
        priority: 'medium',
        steps: [
          { order: 1, action: 'render', target: component.name },
          { order: 2, action: 'trigger', target: 'state_change' },
          { order: 3, action: 'verify', target: 'state', expectedOutput: 'State updated correctly' },
        ],
        preconditions: ['Component mounted'],
        expectedResults: ['State changes correctly', 'Re-render triggered'],
        tags: ['unit', 'state', component.name.toLowerCase()],
        estimatedDuration: 5,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return scenarios;
}

// ============================================
// Performance Scenario Generation
// ============================================
function generatePerformanceScenarios(app: AppStructure): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Screen load time
  for (const screen of app.screens.slice(0, 5)) {
    scenarios.push({
      id: uuidv4(),
      name: `[Performance] ${screen.name} - Load Time`,
      description: `Measure ${screen.name} initial load time`,
      type: 'performance',
      priority: 'high',
      steps: [
        { order: 1, action: 'start_profiling', target: 'cpu_memory' },
        { order: 2, action: 'navigate', target: screen.name },
        { order: 3, action: 'measure', target: 'time_to_interactive', expectedOutput: '< 2000ms' },
        { order: 4, action: 'stop_profiling' },
      ],
      preconditions: ['App is launched', 'Cold start'],
      expectedResults: ['Load time under 2 seconds', 'No frame drops'],
      tags: ['performance', 'load-time', screen.name.toLowerCase()],
      estimatedDuration: 30,
      createdAt: new Date().toISOString(),
    });
  }

  // List scrolling performance
  scenarios.push({
    id: uuidv4(),
    name: '[Performance] List Scrolling - 60fps',
    description: 'Ensure list scrolling maintains 60fps',
    type: 'performance',
    priority: 'high',
    steps: [
      { order: 1, action: 'navigate', target: 'list_screen' },
      { order: 2, action: 'load_data', input: '1000_items' },
      { order: 3, action: 'scroll', target: 'list', input: 'fast_scroll' },
      { order: 4, action: 'measure', target: 'frame_rate', expectedOutput: '>= 60fps' },
    ],
    preconditions: ['List screen available', 'Large dataset loaded'],
    expectedResults: ['Scrolling is smooth', 'No dropped frames'],
    tags: ['performance', 'scrolling', 'fps'],
    estimatedDuration: 45,
    createdAt: new Date().toISOString(),
  });

  // API response time
  for (const api of app.apis.slice(0, 3)) {
    scenarios.push({
      id: uuidv4(),
      name: `[Performance] API: ${api.endpoint} Response Time`,
      description: `Measure ${api.endpoint} response time`,
      type: 'performance',
      priority: 'medium',
      steps: [
        { order: 1, action: 'execute', target: api.endpoint },
        { order: 2, action: 'measure', target: 'response_time', expectedOutput: '< 1000ms' },
      ],
      preconditions: ['Network available'],
      expectedResults: ['Response time under 1 second'],
      tags: ['performance', 'api', 'response-time'],
      estimatedDuration: 10,
      createdAt: new Date().toISOString(),
    });
  }

  return scenarios;
}

// ============================================
// Memory Scenario Generation
// ============================================
function generateMemoryScenarios(app: AppStructure): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Navigation memory leak check
  scenarios.push({
    id: uuidv4(),
    name: '[Memory] Navigation Memory Leak Check',
    description: 'Check for memory leaks during navigation',
    type: 'memory',
    priority: 'critical',
    steps: [
      { order: 1, action: 'snapshot', target: 'heap' },
      { order: 2, action: 'navigate', target: 'screen_a' },
      { order: 3, action: 'navigate', target: 'screen_b' },
      { order: 4, action: 'navigate', target: 'screen_a' },
      { order: 5, action: 'repeat', target: 'steps_2-4', input: '10_times' },
      { order: 6, action: 'snapshot', target: 'heap' },
      { order: 7, action: 'compare', target: 'snapshots', expectedOutput: 'No significant memory increase' },
    ],
    preconditions: ['App is launched'],
    expectedResults: ['No memory leaks detected', 'Memory usage stable'],
    tags: ['memory', 'leak', 'navigation'],
    estimatedDuration: 120,
    createdAt: new Date().toISOString(),
  });

  // Component lifecycle memory check
  for (const component of app.components.filter(c => c.lifecycle.length > 0).slice(0, 3)) {
    scenarios.push({
      id: uuidv4(),
      name: `[Memory] ${component.name} - Lifecycle Cleanup`,
      description: `Verify ${component.name} properly cleans up resources`,
      type: 'memory',
      priority: 'high',
      steps: [
        { order: 1, action: 'snapshot', target: 'heap' },
        { order: 2, action: 'mount', target: component.name },
        { order: 3, action: 'unmount', target: component.name },
        { order: 4, action: 'repeat', target: 'steps_2-3', input: '5_times' },
        { order: 5, action: 'force_gc' },
        { order: 6, action: 'snapshot', target: 'heap' },
        { order: 7, action: 'compare', target: 'snapshots', expectedOutput: 'No retained objects' },
      ],
      preconditions: ['Component available'],
      expectedResults: ['All subscriptions cleaned up', 'No memory retention'],
      tags: ['memory', 'lifecycle', component.name.toLowerCase()],
      estimatedDuration: 60,
      createdAt: new Date().toISOString(),
    });
  }

  // Long session memory check
  scenarios.push({
    id: uuidv4(),
    name: '[Memory] Long Session Stability',
    description: 'Check memory stability during extended use',
    type: 'memory',
    priority: 'high',
    steps: [
      { order: 1, action: 'snapshot', target: 'heap' },
      { order: 2, action: 'simulate', target: 'user_session', input: '30_minutes' },
      { order: 3, action: 'snapshot', target: 'heap' },
      { order: 4, action: 'compare', target: 'snapshots', expectedOutput: 'Memory growth < 50MB' },
    ],
    preconditions: ['App is launched'],
    expectedResults: ['Memory usage remains stable', 'No OOM crashes'],
    tags: ['memory', 'stability', 'long-session'],
    estimatedDuration: 1800,
    createdAt: new Date().toISOString(),
  });

  return scenarios;
}

// ============================================
// Helper Functions
// ============================================
function countCoveredScreens(scenarios: TestScenario[], app: AppStructure): number {
  const coveredScreens = new Set<string>();
  for (const scenario of scenarios) {
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
  }
  return coveredScreens.size;
}

function countCoveredComponents(scenarios: TestScenario[], app: AppStructure): number {
  const coveredComponents = new Set<string>();
  for (const scenario of scenarios) {
    for (const tag of scenario.tags) {
      const matchingComponent = app.components.find(c =>
        c.name.toLowerCase() === tag.toLowerCase()
      );
      if (matchingComponent) {
        coveredComponents.add(matchingComponent.name);
      }
    }
  }
  return coveredComponents.size;
}

function countCoveredApis(scenarios: TestScenario[], app: AppStructure): number {
  return scenarios.filter(s => s.tags.includes('api')).length;
}

function generateSummary(scenarios: TestScenario[], app: AppStructure): string {
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  for (const scenario of scenarios) {
    byType[scenario.type] = (byType[scenario.type] || 0) + 1;
    byPriority[scenario.priority] = (byPriority[scenario.priority] || 0) + 1;
  }

  const typeBreakdown = Object.entries(byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ');

  const priorityBreakdown = Object.entries(byPriority)
    .map(([priority, count]) => `${priority}: ${count}`)
    .join(', ');

  return `Generated ${scenarios.length} test scenarios for ${app.screens.length} screens and ${app.components.length} components. Types: ${typeBreakdown}. Priority: ${priorityBreakdown}.`;
}

export default generateScenarios;
