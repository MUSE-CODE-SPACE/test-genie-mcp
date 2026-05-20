/**
 * Per-tool happy + error path smoke tests.
 *
 * Where the underlying tool needs filesystem context we point at the fixtures.
 * Where it needs storage, we redirect to a temp dir to avoid clobbering real
 * state.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { analyzeAppStructure } from '../src/tools/analysis/analyzeAppStructure.js';
import { generateScenarios } from '../src/tools/analysis/generateScenarios.js';
import { createTestPlan } from '../src/tools/analysis/createTestPlan.js';
import { confirmFix } from '../src/tools/fixing/confirmFix.js';
import { rollbackFix } from '../src/tools/fixing/applyFix.js';
import { suggestFixes } from '../src/tools/fixing/suggestFixes.js';
import { detectMemoryLeaks } from '../src/tools/detection/detectMemoryLeaks.js';
import { detectLogicErrors } from '../src/tools/detection/detectLogicErrors.js';
import { runSimulation } from '../src/tools/execution/runSimulation.js';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

beforeAll(() => {
  process.env.TEST_GENIE_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'test-genie-tools-'));
  process.env.TEST_GENIE_ALLOWED_ROOT = FIXTURE_DIR;
});

describe('analyzeAppStructure', () => {
  it('returns a structure for a known fixture', () => {
    const result = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'react-native-app') });
    expect(result).toBeDefined();
    expect(result.projectPath).toContain('react-native-app');
  });

  it('throws when projectPath does not exist', () => {
    expect(() =>
      analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'nonexistent') }),
    ).toThrow(/does not exist/);
  });
});

describe('generateScenarios', () => {
  it('produces some scenarios from a structure', () => {
    const appStructure = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'react-native-app') });
    const result = generateScenarios({ appStructure, coverage: 'minimal', maxScenarios: 5 });
    expect(result.scenarios).toBeInstanceOf(Array);
  });
});

describe('createTestPlan', () => {
  it('builds an empty plan when no scenarios are given', () => {
    const appStructure = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'react-native-app') });
    const result = createTestPlan({
      name: 'smoke',
      scenarios: [],
      appStructure,
    });
    expect(result.plan.scenarios.length).toBe(0);
  });
});

describe('suggestFixes', () => {
  it('returns no suggestions for an empty issue list', () => {
    const result = suggestFixes({
      issues: [],
      projectPath: path.join(FIXTURE_DIR, 'web-app'),
      platform: 'web',
    });
    expect(result.suggestions.length).toBe(0);
    expect(result.summary.totalSuggestions).toBe(0);
  });
});

describe('detectMemoryLeaks', () => {
  it('returns a result object for a known structure', () => {
    const appStructure = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'react-native-app') });
    const result = detectMemoryLeaks({ appStructure, analysisType: 'static' });
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('recommendations');
  });
});

describe('detectLogicErrors', () => {
  it('returns a result for a known structure', () => {
    const appStructure = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'web-app') });
    const result = detectLogicErrors({ appStructure, analysisDepth: 'shallow' });
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('summary');
  });
});

describe('runSimulation', () => {
  it('returns a result object for a 1s simulation', async () => {
    const appStructure = analyzeAppStructure({ projectPath: path.join(FIXTURE_DIR, 'web-app') });
    const result = await runSimulation({
      appStructure,
      duration: 1,
      userPatterns: ['random'],
    });
    expect(result.summary).toBeTruthy();
  });
});

describe('confirmFix', () => {
  it('errors on unknown fixId', () => {
    const result = confirmFix({ fixId: 'does-not-exist', action: 'approve' });
    expect(result.message).toMatch(/not found|Fix not found/i);
  });
});

describe('rollbackFix', () => {
  it('errors on unknown fixId', () => {
    const result = rollbackFix('does-not-exist');
    expect(result.success).toBe(false);
  });
});
