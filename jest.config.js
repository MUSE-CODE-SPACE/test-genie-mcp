/**
 * Jest config for test-genie-mcp.
 *
 * Tests run as CommonJS (no ESM gymnastics) because the source uses
 * `.js` import suffixes that Jest's resolver natively handles via the
 * mapper below. ts-jest compiles TS source on the fly with the project's
 * tsconfig.test.json.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  collectCoverageFrom: [
    // Core surface — the iterate-fix loop, registry, factory, syntax validator,
    // LLM adapter, security utils. Platform integrations (~5,000 LOC of
    // subprocess wrappers) are excluded from coverage because they're driven
    // by external CLIs that we can't run in CI.
    'src/core/**/*.ts',
    'src/tools/fixing/**/*.ts',
    'src/tools/automation/runIterativeFixLoop.ts',
    'src/llm/**/*.ts',
    'src/security.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 35,
      statements: 35,
      branches: 20,
      functions: 30,
    },
  },
  testTimeout: 30_000,
};
