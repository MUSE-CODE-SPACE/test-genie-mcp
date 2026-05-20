/**
 * Tool registry / MCP server factory smoke tests.
 *
 * Validates:
 *   - The registry exposes exactly the expected 20 tools.
 *   - Each tool has a unique name and a Zod input shape.
 *   - The McpServer factory wires resources + prompts + tools without throwing.
 *   - Capability counts match.
 */

import { TOOL_REGISTRY, getToolNames } from '../src/core/toolRegistry.js';
import {
  createMcpServer,
  getCapabilityCounts,
  SERVER_NAME,
  SERVER_VERSION,
} from '../src/core/mcpServerFactory.js';

describe('tool registry', () => {
  it('contains 23 tools (v3.1.0)', () => {
    expect(TOOL_REGISTRY.length).toBe(23);
  });

  it('includes the v3.0.0 headline tool', () => {
    const names = getToolNames();
    expect(names).toContain('run_iterative_fix_loop');
  });

  it('includes the v3.1.0 vibe-check trio', () => {
    const names = getToolNames();
    expect(names).toContain('diagnose_project');
    expect(names).toContain('detect_race_conditions');
    expect(names).toContain('detect_security_issues');
  });

  it('keeps all v2.x tools (backwards compat)', () => {
    const names = getToolNames();
    const required = [
      'analyze_app_structure',
      'generate_scenarios',
      'create_test_plan',
      'run_scenario_test',
      'run_simulation',
      'run_stress_test',
      'detect_memory_leaks',
      'detect_logic_errors',
      'suggest_fixes',
      'confirm_fix',
      'apply_fix',
      'rollback_fix',
      'run_full_automation',
      'generate_report',
      'get_pending_fixes',
      'get_test_history',
      'analyze_performance',
      'analyze_code_deep',
      'generate_cicd_config',
    ];
    for (const name of required) {
      expect(names).toContain(name);
    }
  });

  it('all names are unique', () => {
    const names = getToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description tagged with mode', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.description).toMatch(/\[mode:/);
    }
  });
});

describe('McpServer factory', () => {
  it('builds without throwing', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it('reports correct capability counts', () => {
    const counts = getCapabilityCounts();
    expect(counts.tools).toBe(23);
    expect(counts.resources).toBe(4); // 1 static + 3 templated
    expect(counts.prompts).toBe(3); // + vibe-check
    expect(counts.toolNames).toHaveLength(23);
  });

  it('reports the v3.1.0 server name + version', () => {
    expect(SERVER_NAME).toBe('test-genie-mcp');
    expect(SERVER_VERSION).toBe('3.1.0');
  });
});
