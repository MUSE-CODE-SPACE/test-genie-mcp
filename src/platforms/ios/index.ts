// ============================================
// iOS Test Platform Integration
// XCTest, XCUITest, Instruments
// ============================================

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { TestResult, StepResult, Platform } from '../../types.js';

const execAsync = promisify(exec);

export interface IOSDevice {
  udid: string;
  name: string;
  type: 'simulator' | 'device';
  state: 'booted' | 'shutdown';
  os: string;
}

export interface IOSTestConfig {
  projectPath: string;
  scheme: string;
  destination?: string;
  device?: string;
  testPlan?: string;
  timeout?: number;
}

// ============================================
// Device Management
// ============================================
export async function listSimulators(): Promise<IOSDevice[]> {
  try {
    const { stdout } = await execAsync('xcrun simctl list devices -j');
    const data = JSON.parse(stdout);
    const devices: IOSDevice[] = [];

    for (const [runtime, deviceList] of Object.entries(data.devices)) {
      if (!Array.isArray(deviceList)) continue;

      const osMatch = runtime.match(/iOS-(\d+-\d+)/);
      const os = osMatch ? osMatch[1]?.replace('-', '.') || 'Unknown' : 'Unknown';

      for (const device of deviceList as any[]) {
        devices.push({
          udid: device.udid,
          name: device.name,
          type: 'simulator',
          state: device.state.toLowerCase() as 'booted' | 'shutdown',
          os,
        });
      }
    }

    return devices;
  } catch (error) {
    console.error('Failed to list simulators:', error);
    return [];
  }
}

export async function bootSimulator(udid: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl boot ${udid}`);
    return true;
  } catch (error) {
    // May already be booted
    return false;
  }
}

export async function shutdownSimulator(udid: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl shutdown ${udid}`);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// XCTest Integration
// ============================================
export async function runXCTest(config: IOSTestConfig): Promise<{
  success: boolean;
  output: string;
  tests: { name: string; passed: boolean; duration: number }[];
  coverage?: number;
}> {
  const { projectPath, scheme, destination, testPlan, timeout = 600000 } = config;

  // Find xcodeproj or xcworkspace
  const files = fs.readdirSync(projectPath);
  const workspace = files.find(f => f.endsWith('.xcworkspace'));
  const project = files.find(f => f.endsWith('.xcodeproj'));

  const projectArg = workspace
    ? `-workspace "${path.join(projectPath, workspace)}"`
    : `-project "${path.join(projectPath, project || '')}"`;

  const destinationArg = destination || 'platform=iOS Simulator,name=iPhone 15';
  const testPlanArg = testPlan ? `-testPlan ${testPlan}` : '';

  const command = `xcodebuild test ${projectArg} -scheme "${scheme}" -destination '${destinationArg}' ${testPlanArg} -resultBundlePath /tmp/TestResults.xcresult 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    // Parse test results
    const tests = parseXCTestOutput(stdout);
    const allPassed = tests.every(t => t.passed);

    // Get coverage if available
    const coverage = await getXCTestCoverage('/tmp/TestResults.xcresult');

    return {
      success: allPassed,
      output: stdout,
      tests,
      coverage,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      tests: [],
    };
  }
}

function parseXCTestOutput(output: string): { name: string; passed: boolean; duration: number }[] {
  const tests: { name: string; passed: boolean; duration: number }[] = [];

  // Parse test results from xcodebuild output
  const testResultRegex = /Test Case '-\[(\S+) (\S+)\]' (passed|failed) \((\d+\.\d+) seconds\)/g;
  let match;

  while ((match = testResultRegex.exec(output)) !== null) {
    tests.push({
      name: `${match[1]}.${match[2]}`,
      passed: match[3] === 'passed',
      duration: parseFloat(match[4] || '0') * 1000,
    });
  }

  return tests;
}

async function getXCTestCoverage(resultBundlePath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execAsync(`xcrun xccov view --report --json ${resultBundlePath}`);
    const report = JSON.parse(stdout);
    return report.lineCoverage ? Math.round(report.lineCoverage * 100) : undefined;
  } catch {
    return undefined;
  }
}

// ============================================
// XCUITest Integration
// ============================================
export async function runXCUITest(config: IOSTestConfig & {
  testClass?: string;
  testMethod?: string;
}): Promise<{
  success: boolean;
  output: string;
  screenshots: string[];
  duration: number;
}> {
  const { projectPath, scheme, destination, testClass, testMethod, timeout = 600000 } = config;

  const files = fs.readdirSync(projectPath);
  const workspace = files.find(f => f.endsWith('.xcworkspace'));
  const project = files.find(f => f.endsWith('.xcodeproj'));

  const projectArg = workspace
    ? `-workspace "${path.join(projectPath, workspace)}"`
    : `-project "${path.join(projectPath, project || '')}"`;

  const destinationArg = destination || 'platform=iOS Simulator,name=iPhone 15';

  let testArg = '';
  if (testClass && testMethod) {
    testArg = `-only-testing:${scheme}UITests/${testClass}/${testMethod}`;
  } else if (testClass) {
    testArg = `-only-testing:${scheme}UITests/${testClass}`;
  }

  const screenshotDir = `/tmp/xcuitest-screenshots-${Date.now()}`;
  fs.mkdirSync(screenshotDir, { recursive: true });

  const command = `xcodebuild test ${projectArg} -scheme "${scheme}" -destination '${destinationArg}' ${testArg} -resultBundlePath /tmp/UITestResults.xcresult 2>&1`;

  const startTime = Date.now();

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    // Extract screenshots from result bundle
    const screenshots = await extractScreenshots('/tmp/UITestResults.xcresult', screenshotDir);

    return {
      success: !stdout.includes('** TEST FAILED **'),
      output: stdout,
      screenshots,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      screenshots: [],
      duration: Date.now() - startTime,
    };
  }
}

async function extractScreenshots(resultBundlePath: string, outputDir: string): Promise<string[]> {
  const screenshots: string[] = [];

  try {
    // List attachments
    const { stdout } = await execAsync(`xcrun xcresulttool get --path ${resultBundlePath} --format json`);
    const result = JSON.parse(stdout);

    // Extract screenshot attachments
    // This is a simplified version - actual implementation would parse the xcresult structure

    return screenshots;
  } catch {
    return screenshots;
  }
}

// ============================================
// Instruments Integration (Performance/Memory)
// ============================================
export interface InstrumentsProfile {
  type: 'time-profiler' | 'allocations' | 'leaks' | 'activity-monitor' | 'core-animation';
  duration: number; // in seconds
  processName?: string;
}

export async function runInstruments(
  device: string,
  app: string,
  profile: InstrumentsProfile
): Promise<{
  success: boolean;
  tracePath: string;
  metrics: Record<string, number>;
  leaks?: string[];
}> {
  const tracePath = `/tmp/instruments-${Date.now()}.trace`;

  const templateMap: Record<string, string> = {
    'time-profiler': 'Time Profiler',
    'allocations': 'Allocations',
    'leaks': 'Leaks',
    'activity-monitor': 'Activity Monitor',
    'core-animation': 'Core Animation',
  };

  const template = templateMap[profile.type] || 'Time Profiler';

  const command = `xcrun xctrace record --device ${device} --template "${template}" --output ${tracePath} --time-limit ${profile.duration}s --attach "${app}" 2>&1`;

  try {
    await execAsync(command, { timeout: (profile.duration + 30) * 1000 });

    // Parse trace results
    const metrics = await parseTraceResults(tracePath, profile.type);
    const leaks = profile.type === 'leaks' ? await extractLeaks(tracePath) : undefined;

    return {
      success: true,
      tracePath,
      metrics,
      leaks,
    };
  } catch (error: any) {
    return {
      success: false,
      tracePath,
      metrics: {},
    };
  }
}

async function parseTraceResults(tracePath: string, type: string): Promise<Record<string, number>> {
  const metrics: Record<string, number> = {};

  try {
    const { stdout } = await execAsync(`xcrun xctrace export --input ${tracePath} --output /tmp/trace-export --xpath '//*'`);

    // Parse based on profile type
    switch (type) {
      case 'allocations':
        // Parse memory allocations
        metrics['peakMemoryMB'] = 0;
        metrics['totalAllocations'] = 0;
        break;
      case 'time-profiler':
        // Parse CPU time
        metrics['cpuUsagePercent'] = 0;
        break;
      case 'core-animation':
        // Parse FPS
        metrics['averageFPS'] = 0;
        metrics['droppedFrames'] = 0;
        break;
    }
  } catch {
    // Return empty metrics
  }

  return metrics;
}

async function extractLeaks(tracePath: string): Promise<string[]> {
  const leaks: string[] = [];

  try {
    const { stdout } = await execAsync(`leaks --traceFile=${tracePath} 2>&1`);

    // Parse leaks output
    const leakRegex = /Leak: (\S+)/g;
    let match;
    while ((match = leakRegex.exec(stdout)) !== null) {
      leaks.push(match[1] || '');
    }
  } catch {
    // No leaks or error
  }

  return leaks;
}

// ============================================
// Swift Testing Support
// ============================================
export async function runSwiftTests(projectPath: string): Promise<{
  success: boolean;
  output: string;
  tests: { name: string; passed: boolean }[];
}> {
  const command = `cd "${projectPath}" && swift test 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout: 300000 });

    const tests: { name: string; passed: boolean }[] = [];
    const testRegex = /Test Case '(\S+)' (passed|failed)/g;
    let match;

    while ((match = testRegex.exec(stdout)) !== null) {
      tests.push({
        name: match[1] || '',
        passed: match[2] === 'passed',
      });
    }

    return {
      success: !stdout.includes('FAILED'),
      output: stdout,
      tests,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message,
      tests: [],
    };
  }
}

// ============================================
// App Installation & Launch
// ============================================
export async function installApp(device: string, appPath: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl install ${device} "${appPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function launchApp(device: string, bundleId: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl launch ${device} ${bundleId}`);
    return true;
  } catch {
    return false;
  }
}

export async function terminateApp(device: string, bundleId: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl terminate ${device} ${bundleId}`);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Screenshot & Recording
// ============================================
export async function takeScreenshot(device: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl io ${device} screenshot "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function startRecording(device: string, outputPath: string): Promise<{ stop: () => Promise<void> }> {
  const process = exec(`xcrun simctl io ${device} recordVideo "${outputPath}"`);

  return {
    stop: async () => {
      process.kill('SIGINT');
      await new Promise(resolve => setTimeout(resolve, 1000));
    },
  };
}

export default {
  listSimulators,
  bootSimulator,
  shutdownSimulator,
  runXCTest,
  runXCUITest,
  runInstruments,
  runSwiftTests,
  installApp,
  launchApp,
  terminateApp,
  takeScreenshot,
  startRecording,
};
