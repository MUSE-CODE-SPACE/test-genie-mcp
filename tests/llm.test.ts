/**
 * LLM module tests.
 *
 * Without provider credentials, the module must report `unavailable` and
 * the LLM fix suggester must gracefully return null. With env set, the
 * provider auto-detect logic must prefer the explicit override.
 */

import { detectProvider, isLlmAvailable } from '../src/llm/index.js';

describe('llm: provider detection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns "none" when no env vars set', () => {
    delete process.env.TEST_GENIE_LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(detectProvider()).toBe('none');
    expect(isLlmAvailable()).toBe(false);
  });

  it('detects anthropic from ANTHROPIC_API_KEY', () => {
    delete process.env.TEST_GENIE_LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
    delete process.env.OPENAI_API_KEY;
    expect(detectProvider()).toBe('anthropic');
    expect(isLlmAvailable()).toBe(true);
  });

  it('detects openai from OPENAI_API_KEY when no anthropic', () => {
    delete process.env.TEST_GENIE_LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-fake';
    expect(detectProvider()).toBe('openai');
  });

  it('explicit TEST_GENIE_LLM_PROVIDER overrides keys', () => {
    process.env.TEST_GENIE_LLM_PROVIDER = 'none';
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
    expect(detectProvider()).toBe('none');
  });

  it('prefers anthropic when both keys set', () => {
    delete process.env.TEST_GENIE_LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'sk-a';
    process.env.OPENAI_API_KEY = 'sk-o';
    expect(detectProvider()).toBe('anthropic');
  });
});

describe('llm: suggestFixWithLlm fallback', () => {
  it('returns unavailable when no provider configured', async () => {
    const { suggestFixWithLlm } = await import('../src/tools/fixing/llmFixSuggester.js');
    delete process.env.TEST_GENIE_LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await suggestFixWithLlm({
      issue: {
        id: 'x',
        type: 'null_reference',
        severity: 'high',
        title: 'X',
        description: 'Y',
        file: '/tmp/foo.ts',
        line: 1,
        detectedAt: new Date().toISOString(),
      },
      platform: 'web',
      projectPath: '/tmp',
      reason: 'no rule match',
    });

    expect(result.status).toBe('unavailable');
    expect(result.suggestion).toBeNull();
  });
});
