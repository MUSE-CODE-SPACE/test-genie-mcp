/**
 * MCP prompts for test-genie-mcp.
 *
 * Two prompt templates ship with v3.0.0:
 *
 *   - `full-test-pipeline` — guided multi-tool flow that takes a user from
 *     "I have a project at X" through analyze → plan → execute → iterate-fix
 *     loop, including which tools to call in what order.
 *
 *   - `diagnose-failure` — focused prompt that walks the model through
 *     classifying a single failing test and proposing the next concrete
 *     action (rerun? request fix? open an issue?).
 *
 * Prompts return the standard MCP `{ description, messages }` shape.
 */

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDescriptor {
  name: string;
  description: string;
  arguments: PromptArgument[];
  build: (args: Record<string, string | undefined>) => {
    description: string;
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
  };
}

const fullTestPipeline: PromptDescriptor = {
  name: 'full-test-pipeline',
  description:
    'Run the complete test-genie pipeline: analyze → plan → execute → iterate-fix-loop. Optimized for "fix until green or stuck".',
  arguments: [
    { name: 'projectPath', description: 'Absolute path to the project root', required: true },
    {
      name: 'platform',
      description: 'ios | android | flutter | react-native | web (auto-detect if omitted)',
      required: false,
    },
    {
      name: 'autoApply',
      description: '"true" to let the loop apply fixes without confirmation (default: false)',
      required: false,
    },
  ],
  build: (args) => {
    const projectPath = args.projectPath ?? '<projectPath>';
    const platform = args.platform ?? '(auto-detect)';
    const autoApply = args.autoApply ?? 'false';

    const text = [
      'You are operating the test-genie-mcp server. Run the full pipeline against the project below.',
      '',
      `Project: ${projectPath}`,
      `Platform: ${platform}`,
      `autoApply: ${autoApply}`,
      '',
      'Recommended sequence:',
      '  1. analyze_app_structure (depth: "normal")',
      '  2. generate_scenarios (coverage: "standard", testTypes: ["unit","integration","e2e"])',
      '  3. create_test_plan (template: "smoke" for first pass)',
      '  4. run_scenario_test for each scenario, OR call run_full_automation as a shortcut',
      '  5. If any tests fail, immediately call run_iterative_fix_loop with:',
      `       projectPath="${projectPath}", strategy="hybrid", autoApply=${autoApply},`,
      '       maxIterations=5, acceptableThreshold=100',
      '  6. When the loop returns:',
      '       - status="success": report final pass-rate and applied fix summary',
      '       - status="paused-for-confirmation": surface each pending fix to the user, then resume',
      '         using the returned resumeToken',
      '       - status="stuck" / "exhausted": surface iteration history + suggest manual review',
      '  7. Optionally call generate_report (format: "markdown") for a sharable artifact.',
      '',
      'Tone: be honest about regressions and rollback events — surface them prominently.',
    ].join('\n');

    return {
      description: 'Guided full test pipeline for test-genie-mcp',
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  },
};

const diagnoseFailure: PromptDescriptor = {
  name: 'diagnose-failure',
  description: 'Focused diagnosis of a single failing test, including a recommended next action.',
  arguments: [
    { name: 'projectPath', description: 'Absolute path to the project', required: true },
    { name: 'scenarioId', description: 'ID of the failing scenario', required: true },
    {
      name: 'failureMessage',
      description: 'The failure message / stack trace, if known',
      required: false,
    },
  ],
  build: (args) => {
    const projectPath = args.projectPath ?? '<projectPath>';
    const scenarioId = args.scenarioId ?? '<scenarioId>';
    const failureMessage = args.failureMessage ?? '(none — fetch from history)';

    const text = [
      'You are diagnosing a single failing test inside the test-genie-mcp pipeline.',
      '',
      `Project: ${projectPath}`,
      `Scenario: ${scenarioId}`,
      `Failure: ${failureMessage}`,
      '',
      'Steps:',
      '  1. Read recent history for this scenario via resource test-genie://test-history/<encoded path>.',
      '  2. If failure looks code-driven, call detect_logic_errors and detect_memory_leaks',
      '     to enumerate suspect issues.',
      '  3. Call suggest_fixes for the related issueIds and pick the highest-confidence candidate.',
      '  4. Recommend ONE of: rerun, apply-fix (with apply_fix), or pause-for-manual-review.',
      '  5. If you recommend apply-fix, explain risk (impact.riskLevel, breakingChange) explicitly',
      '     and remind the user a backup will be created automatically.',
      '',
      'Output should be terse and actionable, ending with a single "Recommended action: …" line.',
    ].join('\n');

    return {
      description: 'Diagnose a single failing scenario',
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
  },
};

export const PROMPT_DESCRIPTORS: PromptDescriptor[] = [fullTestPipeline, diagnoseFailure];

export function findPrompt(name: string): PromptDescriptor | undefined {
  return PROMPT_DESCRIPTORS.find((p) => p.name === name);
}
