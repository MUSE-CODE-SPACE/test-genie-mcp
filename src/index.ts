#!/usr/bin/env node
// ============================================
// Test Genie MCP Server
// AI-powered App Test Automation
// ============================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { analyzeAppStructure } from './tools/analysis/analyzeAppStructure.js';
import { generateScenarios } from './tools/analysis/generateScenarios.js';
import { createTestPlan, createQuickPlan } from './tools/analysis/createTestPlan.js';
import { runScenarioTest, runScenarios } from './tools/execution/runScenarioTest.js';
import { runSimulation } from './tools/execution/runSimulation.js';
import { runStressTest } from './tools/execution/runStressTest.js';
import { detectMemoryLeaks } from './tools/detection/detectMemoryLeaks.js';
import { detectLogicErrors } from './tools/detection/detectLogicErrors.js';
import { suggestFixes } from './tools/fixing/suggestFixes.js';
import { confirmFix, confirmFixes, generateConfirmationPrompt } from './tools/fixing/confirmFix.js';
import { applyFix, applyFixes, rollbackFix } from './tools/fixing/applyFix.js';
import { runFullAutomation } from './tools/automation/runFullAutomation.js';
import { generateReport } from './tools/automation/generateReport.js';
import { generateCICDConfig, writeCICDConfig } from './tools/automation/cicdIntegration.js';

// Import analyzers
import { analyzePerformance } from './analyzers/performanceAnalyzer.js';
import { analyzeProject } from './analyzers/astAnalyzer.js';

// Import storage
import * as storage from './storage/index.js';

// Define tools
const tools: Tool[] = [
  // ============================================
  // Phase 1: Analysis & Scenario Generation
  // ============================================
  {
    name: 'analyze_app_structure',
    description: 'Analyze app codebase structure including screens, components, APIs, and state management. Supports iOS, Android, Flutter, React Native, and Web platforms.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project root directory' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform (auto-detected if not provided)' },
        depth: { type: 'string', enum: ['shallow', 'normal', 'deep'], description: 'Analysis depth level' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'generate_scenarios',
    description: 'Generate test scenarios based on app structure analysis. Creates E2E, integration, unit, performance, and memory test scenarios.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        testTypes: { type: 'array', items: { type: 'string', enum: ['unit', 'integration', 'e2e', 'performance', 'stress', 'memory'] }, description: 'Types of tests to generate' },
        coverage: { type: 'string', enum: ['minimal', 'standard', 'comprehensive'], description: 'Coverage level' },
        focusAreas: { type: 'array', items: { type: 'string' }, description: 'Specific areas to focus on' },
        maxScenarios: { type: 'number', description: 'Maximum number of scenarios to generate' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'create_test_plan',
    description: 'Create a test plan from generated scenarios with filtering and scheduling options.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        name: { type: 'string', description: 'Name of the test plan' },
        priorityFilter: { type: 'array', items: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, description: 'Filter by priority' },
        typeFilter: { type: 'array', items: { type: 'string' }, description: 'Filter by test type' },
        template: { type: 'string', enum: ['smoke', 'regression', 'nightly', 'full'], description: 'Use a predefined template' },
        maxDuration: { type: 'number', description: 'Maximum duration in seconds' },
      },
      required: ['projectPath', 'name'],
    },
  },

  // ============================================
  // Phase 2: Test Execution
  // ============================================
  {
    name: 'run_scenario_test',
    description: 'Run a specific test scenario and get detailed results.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: { type: 'string', description: 'ID of the scenario to run' },
        projectPath: { type: 'string', description: 'Path to the project' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform' },
        device: { type: 'string', description: 'Target device or simulator' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' },
        retries: { type: 'number', description: 'Number of retry attempts' },
      },
      required: ['scenarioId', 'projectPath', 'platform'],
    },
  },
  {
    name: 'run_simulation',
    description: 'Run user behavior simulation to find issues through random/pattern-based testing.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        duration: { type: 'number', description: 'Simulation duration in seconds' },
        userPatterns: { type: 'array', items: { type: 'string', enum: ['random', 'sequential', 'stress', 'idle'] }, description: 'User behavior patterns to simulate' },
        intensity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Interaction intensity' },
        monitorMetrics: { type: 'array', items: { type: 'string', enum: ['memory', 'cpu', 'network', 'render'] }, description: 'Metrics to monitor' },
      },
      required: ['projectPath', 'duration'],
    },
  },
  {
    name: 'run_stress_test',
    description: 'Run stress/load tests on APIs or UI components.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        targetType: { type: 'string', enum: ['api', 'ui', 'navigation', 'all'], description: 'What to stress test' },
        concurrency: { type: 'number', description: 'Number of concurrent users/requests' },
        duration: { type: 'number', description: 'Test duration in seconds' },
        rampUp: { type: 'number', description: 'Ramp up time in seconds' },
        endpoints: { type: 'array', items: { type: 'string' }, description: 'Specific endpoints to test' },
      },
      required: ['projectPath', 'targetType', 'concurrency', 'duration'],
    },
  },

  // ============================================
  // Phase 3: Issue Detection
  // ============================================
  {
    name: 'detect_memory_leaks',
    description: 'Detect memory leaks, retain cycles, and unclosed resources through static and dynamic analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        analysisType: { type: 'string', enum: ['static', 'dynamic', 'both'], description: 'Type of analysis' },
        minLeakSizeMB: { type: 'number', description: 'Minimum leak size to report (MB)' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'detect_logic_errors',
    description: 'Detect logic errors including race conditions, state inconsistencies, null references, and type mismatches.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        analysisDepth: { type: 'string', enum: ['shallow', 'normal', 'deep'], description: 'Analysis depth' },
        checkTypes: { type: 'array', items: { type: 'string', enum: ['race_condition', 'state_inconsistency', 'null_reference', 'type_mismatch', 'all'] }, description: 'Types of errors to check' },
      },
      required: ['projectPath'],
    },
  },

  // ============================================
  // Phase 4: Fix Suggestions & Application
  // ============================================
  {
    name: 'suggest_fixes',
    description: 'Generate AI-powered fix suggestions for detected issues.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        issueIds: { type: 'array', items: { type: 'string' }, description: 'Specific issue IDs to fix' },
        maxSuggestions: { type: 'number', description: 'Maximum suggestions to generate' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'confirm_fix',
    description: 'Confirm or reject a suggested fix before application.',
    inputSchema: {
      type: 'object',
      properties: {
        fixId: { type: 'string', description: 'ID of the fix to confirm' },
        action: { type: 'string', enum: ['approve', 'reject', 'modify'], description: 'Confirmation action' },
        modifiedCode: { type: 'string', description: 'Modified code if action is modify' },
        reason: { type: 'string', description: 'Reason for rejection if action is reject' },
      },
      required: ['fixId', 'action'],
    },
  },
  {
    name: 'apply_fix',
    description: 'Apply a confirmed fix to the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        fixId: { type: 'string', description: 'ID of the fix to apply' },
        backup: { type: 'boolean', description: 'Create backup before applying' },
        validate: { type: 'boolean', description: 'Validate syntax after applying' },
        dryRun: { type: 'boolean', description: 'Preview changes without applying' },
      },
      required: ['fixId'],
    },
  },
  {
    name: 'rollback_fix',
    description: 'Rollback an applied fix to restore original code.',
    inputSchema: {
      type: 'object',
      properties: {
        fixId: { type: 'string', description: 'ID of the fix to rollback' },
      },
      required: ['fixId'],
    },
  },

  // ============================================
  // Phase 5: Full Automation
  // ============================================
  {
    name: 'run_full_automation',
    description: 'Run complete test automation pipeline: analyze → generate scenarios → run tests → detect issues → suggest fixes. Interactive confirmation for fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform' },
        testTypes: { type: 'array', items: { type: 'string', enum: ['unit', 'integration', 'e2e', 'performance', 'memory'] }, description: 'Types of tests to run' },
        autoFix: { type: 'boolean', description: 'Automatically apply high-confidence fixes' },
        confirmMode: { type: 'string', enum: ['auto', 'interactive', 'batch'], description: 'Fix confirmation mode' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'generate_report',
    description: 'Generate detailed test automation report in Markdown, HTML, or JSON format.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        format: { type: 'string', enum: ['markdown', 'html', 'json'], description: 'Report format' },
        sections: { type: 'array', items: { type: 'string', enum: ['summary', 'details', 'issues', 'fixes', 'recommendations'] }, description: 'Sections to include' },
        outputPath: { type: 'string', description: 'Path to save the report' },
      },
      required: ['projectPath'],
    },
  },

  // ============================================
  // Utility Tools
  // ============================================
  {
    name: 'get_pending_fixes',
    description: 'Get list of pending fix suggestions waiting for confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'get_test_history',
    description: 'Get test execution history for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        limit: { type: 'number', description: 'Maximum results to return' },
      },
      required: ['projectPath'],
    },
  },

  // ============================================
  // Enhanced Analysis Tools
  // ============================================
  {
    name: 'analyze_performance',
    description: 'Deep performance analysis including rendering, computation, network, and bundle size issues. Provides actionable recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'analyze_code_deep',
    description: 'Deep AST-based code analysis with function extraction, complexity metrics, hook analysis, and issue detection.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'generate_cicd_config',
    description: 'Generate CI/CD configuration for GitHub Actions, Jenkins, or GitLab CI with test automation integration.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the project' },
        platform: { type: 'string', enum: ['ios', 'android', 'flutter', 'react-native', 'web'], description: 'Target platform' },
        provider: { type: 'string', enum: ['github-actions', 'jenkins', 'gitlab-ci'], description: 'CI/CD provider' },
        testCommand: { type: 'string', description: 'Custom test command' },
        buildCommand: { type: 'string', description: 'Custom build command' },
        branches: { type: 'array', items: { type: 'string' }, description: 'Branches to run CI on' },
        writeToFile: { type: 'boolean', description: 'Write config to project' },
      },
      required: ['projectPath', 'provider'],
    },
  },
];

// Create server
const server = new Server(
  {
    name: 'test-genie-mcp',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    return { content: [{ type: 'text', text: 'Error: No arguments provided' }], isError: true };
  }

  try {
    switch (name) {
      // Analysis tools
      case 'analyze_app_structure': {
        const result = analyzeAppStructure({
          projectPath: args.projectPath as string,
          platform: args.platform as any,
          depth: args.depth as any,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'generate_scenarios': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const result = generateScenarios({
          appStructure,
          testTypes: args.testTypes as any,
          coverage: args.coverage as any,
          focusAreas: args.focusAreas as string[],
          maxScenarios: args.maxScenarios as number,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'create_test_plan': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const scenarios = storage.getScenarios(args.projectPath as string);

        if (args.template) {
          const result = createQuickPlan(
            appStructure,
            scenarios.map(s => s.scenario),
            args.template as any
          );
          return { content: [{ type: 'text', text: result.summary }] };
        }

        const result = createTestPlan({
          name: args.name as string,
          scenarios: scenarios.map(s => s.scenario),
          appStructure,
          priorityFilter: args.priorityFilter as any,
          typeFilter: args.typeFilter as string[],
          maxDuration: args.maxDuration as number,
        });
        return { content: [{ type: 'text', text: result.summary }] };
      }

      // Execution tools
      case 'run_scenario_test': {
        const result = await runScenarioTest({
          scenarioId: args.scenarioId as string,
          projectPath: args.projectPath as string,
          platform: args.platform as any,
          device: args.device as string,
          options: {
            timeout: args.timeout as number,
            retries: args.retries as number,
          },
        });
        return { content: [{ type: 'text', text: result.summary }] };
      }

      case 'run_simulation': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const result = await runSimulation({
          appStructure,
          duration: args.duration as number,
          userPatterns: args.userPatterns as any,
          intensity: args.intensity as any,
          monitorMetrics: args.monitorMetrics as any,
        });
        return { content: [{ type: 'text', text: result.summary }] };
      }

      case 'run_stress_test': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const result = await runStressTest({
          appStructure,
          targetType: args.targetType as any,
          concurrency: args.concurrency as number,
          duration: args.duration as number,
          rampUp: args.rampUp as number,
          endpoints: args.endpoints as string[],
        });
        return { content: [{ type: 'text', text: result.summary }] };
      }

      // Detection tools
      case 'detect_memory_leaks': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const result = detectMemoryLeaks({
          appStructure,
          analysisType: args.analysisType as any,
          thresholds: { minLeakSizeMB: args.minLeakSizeMB as number },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result.summary, null, 2) + '\n\n' + result.recommendations.join('\n') }] };
      }

      case 'detect_logic_errors': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });
        const result = detectLogicErrors({
          appStructure,
          analysisDepth: args.analysisDepth as any,
          checkTypes: args.checkTypes as any,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result.summary, null, 2) + '\n\n' + result.recommendations.join('\n') }] };
      }

      // Fixing tools
      case 'suggest_fixes': {
        const issues = storage.getIssues(args.projectPath as string);
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });

        const filteredIssues = args.issueIds
          ? issues.filter(i => (args.issueIds as string[]).includes(i.id))
          : issues;

        const result = suggestFixes({
          issues: filteredIssues,
          projectPath: args.projectPath as string,
          platform: appStructure.platform,
          maxSuggestions: args.maxSuggestions as number,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result.summary, null, 2) }] };
      }

      case 'confirm_fix': {
        const result = confirmFix({
          fixId: args.fixId as string,
          action: args.action as any,
          modifiedCode: args.modifiedCode as string,
          reason: args.reason as string,
        });
        return { content: [{ type: 'text', text: result.message }] };
      }

      case 'apply_fix': {
        const result = applyFix({
          fixId: args.fixId as string,
          backup: args.backup as boolean,
          validate: args.validate as boolean,
          dryRun: args.dryRun as boolean,
        });

        if (result.success) {
          return { content: [{ type: 'text', text: `Fix applied successfully!\n\n${result.diff || ''}` }] };
        } else {
          return { content: [{ type: 'text', text: `Fix failed: ${result.error}` }] };
        }
      }

      case 'rollback_fix': {
        const result = rollbackFix(args.fixId as string);
        return { content: [{ type: 'text', text: result.message }] };
      }

      // Automation tools
      case 'run_full_automation': {
        const result = await runFullAutomation({
          projectPath: args.projectPath as string,
          platform: args.platform as any,
          testTypes: args.testTypes as any,
          autoFix: args.autoFix as boolean,
          confirmMode: args.confirmMode as any,
          onProgress: (phase, progress, message) => {
            // Progress updates would go here
          },
        });

        let response = result.summary;

        if (result.pendingConfirmations.length > 0) {
          response += '\n\n### Pending Fix Confirmations\n\n';
          for (const fix of result.pendingConfirmations.slice(0, 5)) {
            response += generateConfirmationPrompt(fix) + '\n\n';
          }
        }

        return { content: [{ type: 'text', text: response }] };
      }

      case 'generate_report': {
        const fixes = storage.getFixes(args.projectPath as string);
        const issues = storage.getIssues(args.projectPath as string);
        const results = storage.getTestResults(args.projectPath as string);

        // Create a minimal automation result for report generation
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
        });

        const result = generateReport({
          automationResult: {
            id: 'manual',
            config: {
              projectPath: args.projectPath as string,
              platform: appStructure.platform,
              testTypes: ['e2e'],
              autoFix: false,
              confirmMode: 'batch',
              thresholds: { memoryLeakSizeMB: 10, cpuUsagePercent: 80, renderTimeMs: 16, apiTimeoutMs: 5000, coveragePercent: 80 },
            },
            appStructure,
            testPlan: { id: 'manual', name: 'Manual', description: '', scenarios: [], coverage: { screens: 0, components: 0, apis: 0, stateTransitions: 0, edgeCases: 0 }, createdAt: new Date().toISOString() },
            testResults: results.map(r => r.result),
            detectedIssues: issues,
            fixSuggestions: fixes.map(f => f.fix),
            appliedFixes: fixes.filter(f => f.application).map(f => f.application!),
            summary: {
              totalScenarios: results.length,
              passedScenarios: results.filter(r => r.result.status === 'passed').length,
              failedScenarios: results.filter(r => r.result.status === 'failed').length,
              totalIssues: issues.length,
              criticalIssues: issues.filter(i => i.severity === 'critical').length,
              fixesApplied: fixes.filter(f => f.application?.success).length,
              coveragePercent: 0,
              duration: 0,
            },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
          format: args.format as any,
          sections: args.sections as any,
          outputPath: args.outputPath as string,
        });

        return { content: [{ type: 'text', text: result.content.substring(0, 10000) }] };
      }

      // Utility tools
      case 'get_pending_fixes': {
        const fixes = storage.getPendingFixes(args.projectPath as string);
        return { content: [{ type: 'text', text: JSON.stringify(fixes.map(f => ({ id: f.fix.id, title: f.fix.title, file: f.fix.file, confidence: f.fix.confidence })), null, 2) }] };
      }

      case 'get_test_history': {
        const history = storage.getTestResults(args.projectPath as string, args.limit as number);
        return { content: [{ type: 'text', text: JSON.stringify(history.map(h => ({ id: h.result.id, scenario: h.result.scenarioName, status: h.result.status, duration: h.result.duration, executedAt: h.result.executedAt })), null, 2) }] };
      }

      // Enhanced Analysis Tools
      case 'analyze_performance': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
          platform: args.platform as any,
        });
        const result = await analyzePerformance(args.projectPath as string, appStructure.platform);

        let response = `# Performance Analysis Report\n\n`;
        response += `**Score:** ${result.summary.performanceScore}/100\n\n`;
        response += `**Issues Found:**\n`;
        response += `- Critical: ${result.summary.criticalIssues}\n`;
        response += `- Major: ${result.summary.majorIssues}\n`;
        response += `- Minor: ${result.summary.minorIssues}\n\n`;

        if (result.recommendations.length > 0) {
          response += `## Top Recommendations\n\n`;
          for (const rec of result.recommendations.slice(0, 5)) {
            response += `### [${rec.priority.toUpperCase()}] ${rec.category}\n`;
            response += `${rec.description}\n`;
            response += `*Expected impact: ${rec.estimatedImpact}*\n\n`;
          }
        }

        return { content: [{ type: 'text', text: response }] };
      }

      case 'analyze_code_deep': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
          platform: args.platform as any,
        });
        const result = await analyzeProject(args.projectPath as string, appStructure.platform);

        let response = `# Deep Code Analysis\n\n`;
        response += `**Files Analyzed:** ${result.summary.totalFiles}\n`;
        response += `**Functions:** ${result.summary.totalFunctions}\n`;
        response += `**Classes:** ${result.summary.totalClasses}\n`;
        response += `**Components:** ${result.summary.totalComponents}\n`;
        response += `**Avg Complexity:** ${result.summary.avgComplexity.toFixed(2)}\n\n`;
        response += `**Issues:**\n`;
        response += `- Errors: ${result.summary.issueCount.error}\n`;
        response += `- Warnings: ${result.summary.issueCount.warning}\n`;
        response += `- Info: ${result.summary.issueCount.info}\n`;

        return { content: [{ type: 'text', text: response }] };
      }

      case 'generate_cicd_config': {
        const appStructure = analyzeAppStructure({
          projectPath: args.projectPath as string,
          platform: args.platform as any,
        });

        const cicdConfig = {
          projectPath: args.projectPath as string,
          platform: appStructure.platform,
          provider: args.provider as any,
          options: {
            testCommand: args.testCommand as string,
            buildCommand: args.buildCommand as string,
            branches: args.branches as string[],
          },
        };

        if (args.writeToFile) {
          const result = writeCICDConfig(cicdConfig);
          if (result.success) {
            return { content: [{ type: 'text', text: `CI/CD config written to:\n${result.files.join('\n')}` }] };
          } else {
            return { content: [{ type: 'text', text: 'Failed to write CI/CD config' }], isError: true };
          }
        } else {
          const result = generateCICDConfig(cicdConfig);
          return { content: [{ type: 'text', text: `# ${result.provider} Configuration\n\nFile: \`${result.filePath}\`\n\n\`\`\`yaml\n${result.content}\n\`\`\`` }] };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Test Genie MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
