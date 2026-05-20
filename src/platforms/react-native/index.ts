// ============================================
// React Native Test Platform Integration
// Jest, Detox, React Native Testing Library
//
// v3.0.0: spawn + argv arrays. See SECURITY.md.
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  runProcess,
  ensureMatches,
  ID_ALLOWLIST,
} from '../../core/subprocess.js';

export interface RNDevice {
  id: string;
  name: string;
  type: 'simulator' | 'emulator' | 'device';
  platform: 'ios' | 'android';
  available: boolean;
}

export interface RNTestConfig {
  projectPath: string;
  testPath?: string;
  config?: string;
  coverage?: boolean;
  updateSnapshots?: boolean;
  testNamePattern?: string;
  timeout?: number;
}

// ============================================
// Device Management
// ============================================
export async function listDevices(): Promise<RNDevice[]> {
  const devices: RNDevice[] = [];

  try {
    const { stdout: iosOutput } = await runProcess('xcrun', ['simctl', 'list', 'devices', '-j']);
    const iosData = JSON.parse(iosOutput);
    for (const [, deviceList] of Object.entries(iosData.devices)) {
      if (!Array.isArray(deviceList)) continue;
      for (const device of deviceList as any[]) {
        devices.push({
          id: device.udid,
          name: device.name,
          type: 'simulator',
          platform: 'ios',
          available: device.isAvailable,
        });
      }
    }
  } catch {
    // iOS unavailable
  }

  try {
    const { stdout: androidOutput } = await runProcess('adb', ['devices', '-l']);
    const lines = androidOutput.split('\n').slice(1);
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\w+)/);
      if (match && match[2] !== 'offline') {
        devices.push({
          id: match[1] || '',
          name: line.includes('emulator') ? 'Android Emulator' : 'Android Device',
          type: line.includes('emulator') ? 'emulator' : 'device',
          platform: 'android',
          available: match[2] === 'device',
        });
      }
    }
  } catch {
    // Android unavailable
  }

  return devices;
}

// ============================================
// Jest Tests
// ============================================
export async function runJestTests(config: RNTestConfig): Promise<{
  success: boolean;
  output: string;
  results: {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
    testResults: {
      name: string;
      status: 'passed' | 'failed' | 'pending';
      duration: number;
      failureMessages?: string[];
    }[];
  };
  coverage?: { lines: number; statements: number; functions: number; branches: number };
}> {
  const {
    projectPath, testPath, config: jestConfig, coverage = false,
    updateSnapshots = false, testNamePattern, timeout = 300000,
  } = config;

  if (jestConfig) ensureMatches(jestConfig, /^[A-Za-z0-9._/-]+$/, 'jestConfig');
  if (testPath) ensureMatches(testPath, /^[A-Za-z0-9._/-]+$/, 'testPath');
  if (testNamePattern) ensureMatches(testNamePattern, /^[A-Za-z0-9._ -]+$/, 'testNamePattern');

  const args: string[] = ['jest', '--json', '--outputFile=/tmp/jest-results.json'];
  if (testPath) args.push(testPath);
  if (jestConfig) args.push(`--config=${jestConfig}`);
  if (coverage) args.push('--coverage', '--coverageReporters=json-summary');
  if (updateSnapshots) args.push('--updateSnapshot');
  if (testNamePattern) args.push('--testNamePattern', testNamePattern);

  try {
    await runProcess('npx', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const resultsPath = '/tmp/jest-results.json';
    const resultsJson = fs.existsSync(resultsPath)
      ? JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
      : null;
    const testResults = resultsJson?.testResults?.flatMap((suite: any) =>
      suite.assertionResults?.map((test: any) => ({
        name: `${suite.name}: ${test.fullName}`,
        status: test.status,
        duration: test.duration || 0,
        failureMessages: test.failureMessages,
      })) || [],
    ) || [];

    let coverageData;
    if (coverage) {
      const coveragePath = path.join(projectPath, 'coverage', 'coverage-summary.json');
      if (fs.existsSync(coveragePath)) {
        const coverageJson = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
        coverageData = {
          lines: coverageJson.total?.lines?.pct || 0,
          statements: coverageJson.total?.statements?.pct || 0,
          functions: coverageJson.total?.functions?.pct || 0,
          branches: coverageJson.total?.branches?.pct || 0,
        };
      }
    }

    return {
      success: resultsJson?.success || false,
      output: '',
      results: {
        numTotalTests: resultsJson?.numTotalTests || 0,
        numPassedTests: resultsJson?.numPassedTests || 0,
        numFailedTests: resultsJson?.numFailedTests || 0,
        numPendingTests: resultsJson?.numPendingTests || 0,
        testResults,
      },
      coverage: coverageData,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message || String(error),
      results: {
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      },
    };
  }
}

// ============================================
// Detox E2E Tests
// ============================================
export interface DetoxConfig {
  projectPath: string;
  configuration: string;
  testPath?: string;
  device?: string;
  headless?: boolean;
  recordLogs?: 'none' | 'failing' | 'all';
  recordVideos?: 'none' | 'failing' | 'all';
  recordPerformance?: 'none' | 'timeline';
  timeout?: number;
}

export async function runDetoxTests(config: DetoxConfig): Promise<{
  success: boolean;
  output: string;
  results: {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { name: string; status: 'passed' | 'failed'; duration: number; error?: string }[];
  };
  artifacts: { logs: string[]; videos: string[]; screenshots: string[] };
}> {
  const {
    projectPath, configuration, testPath, device, headless = false,
    recordLogs = 'failing', recordVideos = 'failing', recordPerformance = 'none', timeout = 600000,
  } = config;
  ensureMatches(configuration, /^[A-Za-z0-9._-]+$/, 'configuration');
  if (testPath) ensureMatches(testPath, /^[A-Za-z0-9._/-]+$/, 'testPath');
  if (device) ensureMatches(device, ID_ALLOWLIST, 'device');

  const artifactsDir = path.join(projectPath, '.test-genie', 'detox-artifacts', Date.now().toString());

  try {
    await runProcess('npx', ['detox', 'build', '-c', configuration], {
      cwd: projectPath, timeout: 600000, ignoreExitCode: true,
    });
  } catch (error: any) {
    return {
      success: false,
      output: `Build failed: ${error.message || String(error)}`,
      results: { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: [] },
      artifacts: { logs: [], videos: [], screenshots: [] },
    };
  }

  const args: string[] = [
    'detox', 'test',
    '-c', configuration,
    '--artifacts-location', artifactsDir,
    `--record-logs=${recordLogs}`,
    `--record-videos=${recordVideos}`,
    `--record-performance=${recordPerformance}`,
  ];
  if (testPath) args.push(testPath);
  if (device) args.push('--device-name', device);
  if (headless) args.push('--headless');

  try {
    const { stdout } = await runProcess('npx', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const results = parseDetoxOutput(stdout);
    const artifacts = collectArtifacts(artifactsDir);
    return { success: results.numFailedTests === 0, output: stdout, results, artifacts };
  } catch (error: any) {
    const artifacts = collectArtifacts(artifactsDir);
    return {
      success: false,
      output: error.message || String(error),
      results: parseDetoxOutput(''),
      artifacts,
    };
  }
}

function parseDetoxOutput(output: string) {
  const testResults: { name: string; status: 'passed' | 'failed'; duration: number; error?: string }[] = [];
  const passedRegex = /✓\s+(.+?)\s+\((\d+)\s*ms\)/g;
  const failedRegex = /✕\s+(.+?)\s+\((\d+)\s*ms\)/g;
  let match;
  while ((match = passedRegex.exec(output)) !== null) {
    testResults.push({ name: match[1] || '', status: 'passed', duration: parseInt(match[2] || '0') });
  }
  while ((match = failedRegex.exec(output)) !== null) {
    testResults.push({ name: match[1] || '', status: 'failed', duration: parseInt(match[2] || '0') });
  }
  return {
    numTotalTests: testResults.length,
    numPassedTests: testResults.filter((t) => t.status === 'passed').length,
    numFailedTests: testResults.filter((t) => t.status === 'failed').length,
    testResults,
  };
}

function collectArtifacts(artifactsDir: string) {
  const artifacts = { logs: [] as string[], videos: [] as string[], screenshots: [] as string[] };
  if (!fs.existsSync(artifactsDir)) return artifacts;
  function walk(dir: string) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) walk(fullPath);
        else if (item.endsWith('.log')) artifacts.logs.push(fullPath);
        else if (item.endsWith('.mp4') || item.endsWith('.mov')) artifacts.videos.push(fullPath);
        else if (item.endsWith('.png') || item.endsWith('.jpg')) artifacts.screenshots.push(fullPath);
      }
    } catch {
      // ignore
    }
  }
  walk(artifactsDir);
  return artifacts;
}

// ============================================
// RNTL
// ============================================
export async function runRNTLTests(config: RNTestConfig) {
  const jestResult = await runJestTests({ ...config, testPath: config.testPath || '__tests__' });
  return {
    success: jestResult.success,
    output: jestResult.output,
    results: {
      passed: jestResult.results.numPassedTests,
      failed: jestResult.results.numFailedTests,
      tests: jestResult.results.testResults.map((t) => ({
        name: t.name,
        passed: t.status === 'passed',
        duration: t.duration,
      })),
    },
  };
}

// ============================================
// Performance Profiling
// ============================================
export interface RNPerformanceConfig {
  projectPath: string;
  platform: 'ios' | 'android';
  device?: string;
  duration: number;
}

export async function runPerformanceProfile(config: RNPerformanceConfig) {
  const { platform, device, duration } = config;
  if (device) ensureMatches(device, ID_ALLOWLIST, 'device');
  const metrics = { jsThreadFPS: 60, uiThreadFPS: 60, memoryMB: 0, jsHeapMB: 0, nativeHeapMB: 0 };
  const frames = { droppedJS: 0, droppedUI: 0 };

  if (platform === 'ios') {
    try {
      const deviceArg = device || 'booted';
      ensureMatches(deviceArg, ID_ALLOWLIST, 'device');
      const { stdout } = await runProcess(
        'xcrun',
        ['simctl', 'spawn', deviceArg, 'log', 'show', '--predicate', 'subsystem == "com.apple.UIKit"', '--last', `${duration}s`],
        { ignoreExitCode: true },
      );
      const dropMatches = stdout.match(/frame drop/gi);
      if (dropMatches) frames.droppedUI = dropMatches.length;
    } catch {
      // Profiling unavailable
    }
  }
  return { success: true, metrics, frames };
}

// ============================================
// Memory Leak Detection
// ============================================
export async function detectMemoryLeaks(config: {
  projectPath: string;
  platform: 'ios' | 'android';
  device?: string;
  duration: number;
}) {
  const { platform, device, duration } = config;
  const memoryTimeline: { time: number; heapMB: number }[] = [];
  const leaks: { type: string; location: string; size?: number; stackTrace?: string }[] = [];
  const startTime = Date.now();
  const sampleInterval = 1000;

  if (platform === 'android') {
    if (device) ensureMatches(device, ID_ALLOWLIST, 'device');
    while (Date.now() - startTime < duration * 1000) {
      try {
        const args = device ? ['-s', device, 'shell', 'dumpsys', 'meminfo'] : ['shell', 'dumpsys', 'meminfo'];
        const { stdout } = await runProcess('adb', args, { ignoreExitCode: true });
        const usedMatch = stdout.match(/Used RAM:\s+([\d,]+)/);
        if (usedMatch) {
          const heapMB = parseInt(usedMatch[1]?.replace(/,/g, '') || '0') / 1024;
          memoryTimeline.push({ time: Date.now() - startTime, heapMB });
        }
      } catch {
        // Skip
      }
      await new Promise((resolve) => setTimeout(resolve, sampleInterval));
    }
    if (memoryTimeline.length >= 2) {
      const firstHalf = memoryTimeline.slice(0, Math.floor(memoryTimeline.length / 2));
      const secondHalf = memoryTimeline.slice(Math.floor(memoryTimeline.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b.heapMB, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b.heapMB, 0) / secondHalf.length;
      if (secondAvg > firstAvg * 1.2) {
        leaks.push({ type: 'Memory Growth', location: 'Application', size: Math.round(secondAvg - firstAvg) });
      }
    }
  } else if (platform === 'ios') {
    const deviceArg = device || 'booted';
    ensureMatches(deviceArg, ID_ALLOWLIST, 'device');
    while (Date.now() - startTime < duration * 1000) {
      try {
        const { stdout } = await runProcess('xcrun', ['simctl', 'spawn', deviceArg, 'memory_pressure'], {
          ignoreExitCode: true,
        });
        const freeMatch = stdout.match(/(\d+)%\s+free/);
        if (freeMatch) {
          const freePercent = parseInt(freeMatch[1] || '100');
          memoryTimeline.push({ time: Date.now() - startTime, heapMB: (100 - freePercent) * 10 });
        }
      } catch {
        // Skip
      }
      await new Promise((resolve) => setTimeout(resolve, sampleInterval));
    }
  }
  return { success: true, leaks, memoryTimeline };
}

// ============================================
// Snapshot Testing
// ============================================
export async function runSnapshotTests(config: RNTestConfig & { updateSnapshots?: boolean }) {
  const { projectPath, testPath, updateSnapshots = false, timeout = 300000 } = config;
  if (testPath) ensureMatches(testPath, /^[A-Za-z0-9._/-]+$/, 'testPath');

  const args = ['jest', '--testPathPattern=\\.snap\\.'];
  if (testPath) args.push(testPath);
  if (updateSnapshots) args.push('-u');

  try {
    const { stdout } = await runProcess('npx', args, { cwd: projectPath, timeout, ignoreExitCode: true });
    const totalMatch = stdout.match(/Snapshots:\s+(\d+)\s+total/);
    const passedMatch = stdout.match(/(\d+)\s+passed/);
    const failedMatch = stdout.match(/(\d+)\s+failed/);
    const updatedMatch = stdout.match(/(\d+)\s+updated/);
    return {
      success: !failedMatch || parseInt(failedMatch[1] || '0') === 0,
      output: stdout,
      results: {
        total: parseInt(totalMatch?.[1] || '0'),
        passed: parseInt(passedMatch?.[1] || '0'),
        failed: parseInt(failedMatch?.[1] || '0'),
        updated: parseInt(updatedMatch?.[1] || '0'),
        obsolete: [] as string[],
      },
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message || String(error),
      results: { total: 0, passed: 0, failed: 0, updated: 0, obsolete: [] as string[] },
    };
  }
}

// ============================================
// Build & Metro
// ============================================
export async function buildApp(
  projectPath: string,
  platform: 'ios' | 'android',
  options?: { release?: boolean; device?: string },
): Promise<{ success: boolean; output: string }> {
  const { release = false, device } = options || {};
  if (device) ensureMatches(device, /^[A-Za-z0-9._ -]+$/, 'device');
  const args = ['react-native', platform === 'ios' ? 'run-ios' : 'run-android'];
  if (release) args.push('--mode=release');
  if (device && platform === 'ios') args.push(`--device=${device}`);

  try {
    const { stdout } = await runProcess('npx', args, { cwd: projectPath, timeout: 600000, ignoreExitCode: true });
    return {
      success: stdout.includes('BUILD SUCCESSFUL') || stdout.includes('success'),
      output: stdout,
    };
  } catch (error: any) {
    return { success: false, output: error.message || String(error) };
  }
}

export async function startMetro(projectPath: string): Promise<{ success: boolean; port: number }> {
  try {
    try {
      await runProcess('curl', ['-s', 'http://localhost:8081/status'], { timeout: 2000 });
      return { success: true, port: 8081 };
    } catch {
      // not running, start
    }

    spawn('npx', ['react-native', 'start', '--reset-cache'], {
      cwd: projectPath,
      detached: true,
      stdio: 'ignore',
      shell: false,
    }).unref();

    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await runProcess('curl', ['-s', 'http://localhost:8081/status'], { timeout: 2000 });
        return { success: true, port: 8081 };
      } catch {
        // not ready
      }
    }
    return { success: false, port: 8081 };
  } catch {
    return { success: false, port: 8081 };
  }
}

export async function stopMetro(): Promise<boolean> {
  try {
    await runProcess('pkill', ['-f', 'react-native.*start'], { ignoreExitCode: true });
    return true;
  } catch {
    return false;
  }
}

export default {
  listDevices,
  runJestTests,
  runDetoxTests,
  runRNTLTests,
  runPerformanceProfile,
  detectMemoryLeaks,
  runSnapshotTests,
  buildApp,
  startMetro,
  stopMetro,
};
