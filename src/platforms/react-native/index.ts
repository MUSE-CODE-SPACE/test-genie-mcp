// ============================================
// React Native Test Platform Integration
// Jest, Detox, React Native Testing Library
// ============================================

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { TestResult, StepResult, Platform } from '../../types.js';

const execAsync = promisify(exec);

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
    // iOS Simulators
    const { stdout: iosOutput } = await execAsync('xcrun simctl list devices -j');
    const iosData = JSON.parse(iosOutput);

    for (const [runtime, deviceList] of Object.entries(iosData.devices)) {
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
    // iOS not available
  }

  try {
    // Android Emulators
    const { stdout: androidOutput } = await execAsync('adb devices -l');
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
    // Android not available
  }

  return devices;
}

// ============================================
// Jest Tests (Unit & Component)
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
  coverage?: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
}> {
  const {
    projectPath,
    testPath,
    config: jestConfig,
    coverage = false,
    updateSnapshots = false,
    testNamePattern,
    timeout = 300000,
  } = config;

  const args: string[] = ['--json', '--outputFile=/tmp/jest-results.json'];

  if (testPath) args.push(testPath);
  if (jestConfig) args.push(`--config=${jestConfig}`);
  if (coverage) args.push('--coverage', '--coverageReporters=json-summary');
  if (updateSnapshots) args.push('--updateSnapshot');
  if (testNamePattern) args.push(`--testNamePattern="${testNamePattern}"`);

  const command = `cd "${projectPath}" && npx jest ${args.join(' ')} 2>&1`;

  try {
    await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    // Read JSON results
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
      })) || []
    ) || [];

    // Read coverage if enabled
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
    // Try to parse partial results
    const resultsPath = '/tmp/jest-results.json';
    let results = {
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [] as any[],
    };

    if (fs.existsSync(resultsPath)) {
      try {
        const resultsJson = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
        results = {
          numTotalTests: resultsJson.numTotalTests || 0,
          numPassedTests: resultsJson.numPassedTests || 0,
          numFailedTests: resultsJson.numFailedTests || 0,
          numPendingTests: resultsJson.numPendingTests || 0,
          testResults: resultsJson.testResults?.flatMap((suite: any) =>
            suite.assertionResults?.map((test: any) => ({
              name: `${suite.name}: ${test.fullName}`,
              status: test.status,
              duration: test.duration || 0,
              failureMessages: test.failureMessages,
            })) || []
          ) || [],
        };
      } catch {
        // Ignore parse errors
      }
    }

    return {
      success: false,
      output: error.stdout || error.message,
      results,
    };
  }
}

// ============================================
// Detox E2E Tests
// ============================================
export interface DetoxConfig {
  projectPath: string;
  configuration: string; // e.g., 'ios.sim.debug', 'android.emu.release'
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
    testResults: {
      name: string;
      status: 'passed' | 'failed';
      duration: number;
      error?: string;
    }[];
  };
  artifacts: {
    logs: string[];
    videos: string[];
    screenshots: string[];
  };
}> {
  const {
    projectPath,
    configuration,
    testPath,
    device,
    headless = false,
    recordLogs = 'failing',
    recordVideos = 'failing',
    recordPerformance = 'none',
    timeout = 600000,
  } = config;

  const artifactsDir = path.join(projectPath, '.test-genie', 'detox-artifacts', Date.now().toString());

  const args: string[] = [
    '-c', configuration,
    '--artifacts-location', artifactsDir,
    `--record-logs=${recordLogs}`,
    `--record-videos=${recordVideos}`,
    `--record-performance=${recordPerformance}`,
  ];

  if (testPath) args.push(testPath);
  if (device) args.push('--device-name', device);
  if (headless) args.push('--headless');

  // Build first
  const buildCommand = `cd "${projectPath}" && npx detox build -c ${configuration} 2>&1`;

  try {
    await execAsync(buildCommand, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
  } catch (error: any) {
    return {
      success: false,
      output: `Build failed: ${error.message}`,
      results: {
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        testResults: [],
      },
      artifacts: { logs: [], videos: [], screenshots: [] },
    };
  }

  // Run tests
  const testCommand = `cd "${projectPath}" && npx detox test ${args.join(' ')} 2>&1`;

  try {
    const { stdout } = await execAsync(testCommand, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const results = parseDetoxOutput(stdout);
    const artifacts = collectArtifacts(artifactsDir);

    return {
      success: results.numFailedTests === 0,
      output: stdout,
      results,
      artifacts,
    };
  } catch (error: any) {
    const results = parseDetoxOutput(error.stdout || '');
    const artifacts = collectArtifacts(artifactsDir);

    return {
      success: false,
      output: error.stdout || error.message,
      results,
      artifacts,
    };
  }
}

function parseDetoxOutput(output: string): {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: {
    name: string;
    status: 'passed' | 'failed';
    duration: number;
    error?: string;
  }[];
} {
  const testResults: {
    name: string;
    status: 'passed' | 'failed';
    duration: number;
    error?: string;
  }[] = [];

  // Parse test results from Detox/Jest output
  const passedRegex = /✓\s+(.+?)\s+\((\d+)\s*ms\)/g;
  const failedRegex = /✕\s+(.+?)\s+\((\d+)\s*ms\)/g;

  let match;
  while ((match = passedRegex.exec(output)) !== null) {
    testResults.push({
      name: match[1] || '',
      status: 'passed',
      duration: parseInt(match[2] || '0'),
    });
  }

  while ((match = failedRegex.exec(output)) !== null) {
    testResults.push({
      name: match[1] || '',
      status: 'failed',
      duration: parseInt(match[2] || '0'),
    });
  }

  return {
    numTotalTests: testResults.length,
    numPassedTests: testResults.filter(t => t.status === 'passed').length,
    numFailedTests: testResults.filter(t => t.status === 'failed').length,
    testResults,
  };
}

function collectArtifacts(artifactsDir: string): {
  logs: string[];
  videos: string[];
  screenshots: string[];
} {
  const artifacts = {
    logs: [] as string[],
    videos: [] as string[],
    screenshots: [] as string[],
  };

  if (!fs.existsSync(artifactsDir)) {
    return artifacts;
  }

  function walk(dir: string) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          if (item.endsWith('.log')) {
            artifacts.logs.push(fullPath);
          } else if (item.endsWith('.mp4') || item.endsWith('.mov')) {
            artifacts.videos.push(fullPath);
          } else if (item.endsWith('.png') || item.endsWith('.jpg')) {
            artifacts.screenshots.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  walk(artifactsDir);
  return artifacts;
}

// ============================================
// React Native Testing Library (RNTL)
// ============================================
export async function runRNTLTests(config: RNTestConfig): Promise<{
  success: boolean;
  output: string;
  results: {
    passed: number;
    failed: number;
    tests: {
      name: string;
      passed: boolean;
      duration: number;
    }[];
  };
}> {
  // RNTL uses Jest, so we can reuse Jest runner with specific config
  const jestResult = await runJestTests({
    ...config,
    testPath: config.testPath || '__tests__',
  });

  return {
    success: jestResult.success,
    output: jestResult.output,
    results: {
      passed: jestResult.results.numPassedTests,
      failed: jestResult.results.numFailedTests,
      tests: jestResult.results.testResults.map(t => ({
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
  duration: number; // seconds
}

export async function runPerformanceProfile(config: RNPerformanceConfig): Promise<{
  success: boolean;
  metrics: {
    jsThreadFPS: number;
    uiThreadFPS: number;
    memoryMB: number;
    jsHeapMB: number;
    nativeHeapMB: number;
  };
  frames: {
    droppedJS: number;
    droppedUI: number;
  };
}> {
  const { projectPath, platform, device, duration } = config;

  // Use Flipper/React Native Debugger metrics
  // For now, simulate collection

  const metrics = {
    jsThreadFPS: 60,
    uiThreadFPS: 60,
    memoryMB: 0,
    jsHeapMB: 0,
    nativeHeapMB: 0,
  };

  const frames = {
    droppedJS: 0,
    droppedUI: 0,
  };

  if (platform === 'android') {
    try {
      // Use Android profiler
      const deviceArg = device ? `-s ${device}` : '';

      // Get memory info
      const { stdout: memInfo } = await execAsync(
        `adb ${deviceArg} shell dumpsys meminfo $(adb ${deviceArg} shell pidof -s com.$(cd "${projectPath}" && cat package.json | grep '"name"' | cut -d'"' -f4))`
      );

      const totalMatch = memInfo.match(/TOTAL:\s+(\d+)/);
      if (totalMatch) {
        metrics.memoryMB = parseInt(totalMatch[1] || '0') / 1024;
      }

      // Get frame stats
      const { stdout: frameInfo } = await execAsync(
        `adb ${deviceArg} shell dumpsys gfxinfo $(adb ${deviceArg} shell pidof -s com.$(cd "${projectPath}" && cat package.json | grep '"name"' | cut -d'"' -f4))`
      );

      const jankyMatch = frameInfo.match(/Janky frames:\s+(\d+)/);
      if (jankyMatch) {
        frames.droppedUI = parseInt(jankyMatch[1] || '0');
      }
    } catch {
      // Profiling not available
    }
  } else if (platform === 'ios') {
    try {
      // Use Instruments or simctl
      // This is a simplified version
      const deviceArg = device || 'booted';

      const { stdout } = await execAsync(`xcrun simctl spawn ${deviceArg} log show --predicate 'subsystem == "com.apple.UIKit"' --last ${duration}s 2>&1`);

      // Parse frame drops from logs (simplified)
      const dropMatches = stdout.match(/frame drop/gi);
      if (dropMatches) {
        frames.droppedUI = dropMatches.length;
      }
    } catch {
      // Profiling not available
    }
  }

  return {
    success: true,
    metrics,
    frames,
  };
}

// ============================================
// Memory Leak Detection
// ============================================
export async function detectMemoryLeaks(config: {
  projectPath: string;
  platform: 'ios' | 'android';
  device?: string;
  duration: number;
}): Promise<{
  success: boolean;
  leaks: {
    type: string;
    location: string;
    size?: number;
    stackTrace?: string;
  }[];
  memoryTimeline: {
    time: number;
    heapMB: number;
  }[];
}> {
  const { projectPath, platform, device, duration } = config;
  const memoryTimeline: { time: number; heapMB: number }[] = [];
  const leaks: { type: string; location: string; size?: number; stackTrace?: string }[] = [];

  const startTime = Date.now();
  const sampleInterval = 1000; // 1 second

  if (platform === 'android') {
    const deviceArg = device ? `-s ${device}` : '';

    // Sample memory over time
    while (Date.now() - startTime < duration * 1000) {
      try {
        const { stdout } = await execAsync(`adb ${deviceArg} shell dumpsys meminfo | grep -A 5 "Total RAM"`);
        const usedMatch = stdout.match(/Used RAM:\s+([\d,]+)/);
        if (usedMatch) {
          const heapMB = parseInt(usedMatch[1]?.replace(/,/g, '') || '0') / 1024;
          memoryTimeline.push({
            time: Date.now() - startTime,
            heapMB,
          });
        }
      } catch {
        // Skip this sample
      }
      await new Promise(resolve => setTimeout(resolve, sampleInterval));
    }

    // Analyze for leaks
    if (memoryTimeline.length >= 2) {
      const firstHalf = memoryTimeline.slice(0, Math.floor(memoryTimeline.length / 2));
      const secondHalf = memoryTimeline.slice(Math.floor(memoryTimeline.length / 2));

      const firstAvg = firstHalf.reduce((a, b) => a + b.heapMB, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b.heapMB, 0) / secondHalf.length;

      if (secondAvg > firstAvg * 1.2) {
        leaks.push({
          type: 'Memory Growth',
          location: 'Application',
          size: Math.round(secondAvg - firstAvg),
        });
      }
    }
  } else if (platform === 'ios') {
    // iOS memory monitoring
    const deviceArg = device || 'booted';

    while (Date.now() - startTime < duration * 1000) {
      try {
        // Use simctl to get memory info (simplified)
        const { stdout } = await execAsync(`xcrun simctl spawn ${deviceArg} memory_pressure`);
        // Parse memory info
        const freeMatch = stdout.match(/(\d+)%\s+free/);
        if (freeMatch) {
          // Estimate heap usage
          const freePercent = parseInt(freeMatch[1] || '100');
          memoryTimeline.push({
            time: Date.now() - startTime,
            heapMB: (100 - freePercent) * 10, // Rough estimate
          });
        }
      } catch {
        // Skip this sample
      }
      await new Promise(resolve => setTimeout(resolve, sampleInterval));
    }
  }

  return {
    success: true,
    leaks,
    memoryTimeline,
  };
}

// ============================================
// Snapshot Testing
// ============================================
export async function runSnapshotTests(config: RNTestConfig & {
  updateSnapshots?: boolean;
}): Promise<{
  success: boolean;
  output: string;
  results: {
    total: number;
    passed: number;
    failed: number;
    updated: number;
    obsolete: string[];
  };
}> {
  const { projectPath, testPath, updateSnapshots = false, timeout = 300000 } = config;

  const args: string[] = ['--testPathPattern=\\.snap\\.'];

  if (testPath) args.push(testPath);
  if (updateSnapshots) args.push('-u');

  const command = `cd "${projectPath}" && npx jest ${args.join(' ')} 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    // Parse snapshot results
    const totalMatch = stdout.match(/Snapshots:\s+(\d+)\s+total/);
    const passedMatch = stdout.match(/(\d+)\s+passed/);
    const failedMatch = stdout.match(/(\d+)\s+failed/);
    const updatedMatch = stdout.match(/(\d+)\s+updated/);
    const obsoleteMatch = stdout.match(/(\d+)\s+obsolete/);

    return {
      success: !failedMatch || parseInt(failedMatch[1] || '0') === 0,
      output: stdout,
      results: {
        total: parseInt(totalMatch?.[1] || '0'),
        passed: parseInt(passedMatch?.[1] || '0'),
        failed: parseInt(failedMatch?.[1] || '0'),
        updated: parseInt(updatedMatch?.[1] || '0'),
        obsolete: [],
      },
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      results: {
        total: 0,
        passed: 0,
        failed: 0,
        updated: 0,
        obsolete: [],
      },
    };
  }
}

// ============================================
// App Build & Installation
// ============================================
export async function buildApp(
  projectPath: string,
  platform: 'ios' | 'android',
  options?: {
    release?: boolean;
    device?: string;
  }
): Promise<{ success: boolean; output: string }> {
  const { release = false, device } = options || {};

  const modeArg = release ? '--mode=release' : '';

  let command: string;
  if (platform === 'ios') {
    command = `cd "${projectPath}" && npx react-native run-ios ${modeArg} ${device ? `--device="${device}"` : ''} 2>&1`;
  } else {
    command = `cd "${projectPath}" && npx react-native run-android ${modeArg} 2>&1`;
  }

  try {
    const { stdout } = await execAsync(command, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    return {
      success: stdout.includes('BUILD SUCCESSFUL') || stdout.includes('success'),
      output: stdout,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
    };
  }
}

// ============================================
// Metro Bundler Management
// ============================================
export async function startMetro(projectPath: string): Promise<{
  success: boolean;
  port: number;
}> {
  try {
    // Check if Metro is already running
    try {
      await execAsync('curl -s http://localhost:8081/status');
      return { success: true, port: 8081 };
    } catch {
      // Not running, start it
    }

    // Start Metro in background
    exec(`cd "${projectPath}" && npx react-native start --reset-cache`, {
      cwd: projectPath,
    });

    // Wait for Metro to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        await execAsync('curl -s http://localhost:8081/status');
        return { success: true, port: 8081 };
      } catch {
        // Not ready yet
      }
    }

    return { success: false, port: 8081 };
  } catch {
    return { success: false, port: 8081 };
  }
}

export async function stopMetro(): Promise<boolean> {
  try {
    await execAsync('pkill -f "react-native.*start"');
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
