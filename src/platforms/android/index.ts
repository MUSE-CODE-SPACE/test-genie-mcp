// ============================================
// Android Test Platform Integration
// Espresso, UI Automator, Android Profiler
//
// v3.0.0: spawn + argv arrays + validated user input. See SECURITY.md for
// the subprocess audit summary.
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  runProcess,
  ensureMatches,
  ID_ALLOWLIST,
} from '../../core/subprocess.js';

const PACKAGE_NAME_REGEX = /^[A-Za-z0-9._-]+$/;
const ACTIVITY_REGEX = /^[A-Za-z0-9._$-]+$/;

export interface AndroidDevice {
  id: string;
  name: string;
  type: 'emulator' | 'device';
  state: 'online' | 'offline' | 'unauthorized';
  apiLevel: number;
}

export interface AndroidTestConfig {
  projectPath: string;
  module?: string;
  testClass?: string;
  testMethod?: string;
  device?: string;
  timeout?: number;
}

// ============================================
// Device Management
// ============================================
export async function listDevices(): Promise<AndroidDevice[]> {
  try {
    const { stdout } = await runProcess('adb', ['devices', '-l']);
    const lines = stdout.split('\n').slice(1);
    const devices: AndroidDevice[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(/\s+/);
      const id = parts[0];
      const state = parts[1];
      if (!id || !state) continue;
      const isEmulator = id.startsWith('emulator');
      let name = 'Unknown';
      let apiLevel = 0;
      try {
        ensureMatches(id, ID_ALLOWLIST, 'deviceId');
        const { stdout: model } = await runProcess('adb', ['-s', id, 'shell', 'getprop', 'ro.product.model']);
        name = model.trim() || 'Unknown';
        const { stdout: sdk } = await runProcess('adb', ['-s', id, 'shell', 'getprop', 'ro.build.version.sdk']);
        apiLevel = parseInt(sdk.trim()) || 0;
      } catch {
        // device may not be accessible / id not allowlist-safe
      }
      devices.push({
        id,
        name,
        type: isEmulator ? 'emulator' : 'device',
        state: state as 'online' | 'offline' | 'unauthorized',
        apiLevel,
      });
    }
    return devices;
  } catch (error) {
    console.error('Failed to list devices:', error);
    return [];
  }
}

export async function listEmulators(): Promise<string[]> {
  try {
    const { stdout } = await runProcess('emulator', ['-list-avds']);
    return stdout.split('\n').filter((line) => line.trim());
  } catch {
    return [];
  }
}

export async function startEmulator(avdName: string): Promise<boolean> {
  try {
    ensureMatches(avdName, ID_ALLOWLIST, 'avdName');
    spawn('emulator', ['-avd', avdName, '-no-snapshot-load'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    }).unref();

    await runProcess('adb', ['wait-for-device'], { timeout: 120000, ignoreExitCode: true });
    await runProcess('adb', ['shell', 'getprop', 'sys.boot_completed'], { timeout: 60000, ignoreExitCode: true });
    return true;
  } catch {
    return false;
  }
}

export async function stopEmulator(deviceId: string): Promise<boolean> {
  try {
    ensureMatches(deviceId, ID_ALLOWLIST, 'deviceId');
    await runProcess('adb', ['-s', deviceId, 'emu', 'kill']);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Gradle Test Integration
// ============================================
export async function runGradleTests(config: AndroidTestConfig): Promise<{
  success: boolean;
  output: string;
  tests: { name: string; passed: boolean; duration: number }[];
  coverage?: number;
}> {
  const { projectPath, module = 'app', testClass, testMethod, device, timeout = 600000 } = config;
  ensureMatches(module, ID_ALLOWLIST, 'module');
  if (testClass) ensureMatches(testClass, PACKAGE_NAME_REGEX, 'testClass');
  if (testMethod) ensureMatches(testMethod, ID_ALLOWLIST, 'testMethod');
  if (device) ensureMatches(device, ID_ALLOWLIST, 'device');

  const gradleArgs = [`:${module}:testDebugUnitTest`];
  if (testClass && testMethod) gradleArgs.push('--tests', `${testClass}.${testMethod}`);
  else if (testClass) gradleArgs.push('--tests', testClass);
  if (device) gradleArgs.push(`-Pandroid.testInstrumentationRunnerArguments.device=${device}`);
  gradleArgs.push('--info');

  try {
    // Ensure gradlew is executable.
    try {
      fs.chmodSync(path.join(projectPath, 'gradlew'), 0o755);
    } catch {
      // best effort
    }
    const { stdout } = await runProcess('sh', ['./gradlew', ...gradleArgs], {
      cwd: projectPath,
      timeout,
      ignoreExitCode: true,
      skipAllowlist: true,
    }).catch(async () => {
      // Fall through to plain gradle (system gradle).
      return runProcess('gradle', gradleArgs, { cwd: projectPath, timeout, ignoreExitCode: true });
    });

    const tests = parseGradleTestOutput(stdout);
    const allPassed = tests.every((t) => t.passed);
    const coverage = await getJacocoCoverage(projectPath, module);
    return { success: allPassed, output: stdout, tests, coverage };
  } catch (error: any) {
    return { success: false, output: error.message || String(error), tests: [] };
  }
}

function parseGradleTestOutput(output: string): { name: string; passed: boolean; duration: number }[] {
  const tests: { name: string; passed: boolean; duration: number }[] = [];
  const testRegex = /(\S+) > (\S+)\s+(PASSED|FAILED)\s*(?:\((\d+)s\))?/g;
  let match;
  while ((match = testRegex.exec(output)) !== null) {
    tests.push({
      name: `${match[1]}.${match[2]}`,
      passed: match[3] === 'PASSED',
      duration: (parseInt(match[4] || '0') || 0) * 1000,
    });
  }
  return tests;
}

async function getJacocoCoverage(projectPath: string, module: string): Promise<number | undefined> {
  const reportPath = path.join(projectPath, module, 'build', 'reports', 'jacoco', 'testDebugUnitTestCoverage', 'html', 'index.html');
  if (!fs.existsSync(reportPath)) return undefined;
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const coverageMatch = content.match(/Total.*?(\d+)%/);
    return coverageMatch ? parseInt(coverageMatch[1] || '0') : undefined;
  } catch {
    return undefined;
  }
}

// ============================================
// Espresso (Instrumented Tests)
// ============================================
export async function runEspressoTests(config: AndroidTestConfig): Promise<{
  success: boolean;
  output: string;
  tests: { name: string; passed: boolean; duration: number }[];
  screenshots: string[];
}> {
  const { projectPath, module = 'app', testClass, testMethod, device, timeout = 600000 } = config;
  ensureMatches(module, ID_ALLOWLIST, 'module');
  if (testClass) ensureMatches(testClass, PACKAGE_NAME_REGEX, 'testClass');
  if (testMethod) ensureMatches(testMethod, ID_ALLOWLIST, 'testMethod');

  const gradleArgs = [`:${module}:connectedDebugAndroidTest`];
  if (testClass && testMethod) gradleArgs.push(`-Pandroid.testInstrumentationRunnerArguments.class=${testClass}#${testMethod}`);
  else if (testClass) gradleArgs.push(`-Pandroid.testInstrumentationRunnerArguments.class=${testClass}`);
  gradleArgs.push('--info');

  try {
    const { stdout } = await runProcess('sh', ['./gradlew', ...gradleArgs], {
      cwd: projectPath, timeout, ignoreExitCode: true, skipAllowlist: true,
    });
    const tests = parseGradleTestOutput(stdout);
    const screenshots = await pullScreenshots(device || 'default');
    return { success: !stdout.includes('FAILED'), output: stdout, tests, screenshots };
  } catch (error: any) {
    return { success: false, output: error.message || String(error), tests: [], screenshots: [] };
  }
}

async function pullScreenshots(device: string): Promise<string[]> {
  const screenshots: string[] = [];
  const localDir = `/tmp/android-screenshots-${Date.now()}`;
  fs.mkdirSync(localDir, { recursive: true });
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    await runProcess('adb', ['-s', device, 'pull', '/sdcard/Pictures/Screenshots', localDir], {
      ignoreExitCode: true,
    });
    if (fs.existsSync(localDir)) {
      const files = fs.readdirSync(localDir);
      for (const file of files) {
        if (file.endsWith('.png') || file.endsWith('.jpg')) {
          screenshots.push(path.join(localDir, file));
        }
      }
    }
  } catch {
    // no screenshots
  }
  return screenshots;
}

// ============================================
// UI Automator
// ============================================
export async function runUIAutomator(
  device: string,
  testPackage: string,
  testClass?: string,
): Promise<{ success: boolean; output: string }> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(testPackage, PACKAGE_NAME_REGEX, 'testPackage');
    if (testClass) ensureMatches(testClass, PACKAGE_NAME_REGEX, 'testClass');
    const args = ['-s', device, 'shell', 'am', 'instrument', '-w'];
    if (testClass) args.push('-e', 'class', testClass);
    args.push(`${testPackage}/androidx.test.runner.AndroidJUnitRunner`);
    const { stdout } = await runProcess('adb', args, { timeout: 300000, ignoreExitCode: true });
    return {
      success: stdout.includes('OK') && !stdout.includes('FAILURES'),
      output: stdout,
    };
  } catch (error: any) {
    return { success: false, output: error.message || String(error) };
  }
}

// ============================================
// Android Profiler Integration
// ============================================
export interface ProfilerConfig {
  type: 'cpu' | 'memory' | 'network' | 'energy';
  duration: number;
  packageName: string;
  device: string;
}

export async function runProfiler(config: ProfilerConfig): Promise<{
  success: boolean;
  metrics: Record<string, number>;
  tracePath?: string;
}> {
  const { type, duration, packageName, device } = config;
  ensureMatches(device, ID_ALLOWLIST, 'device');
  ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');

  const tracePath = `/tmp/android-profile-${Date.now()}.trace`;
  switch (type) {
    case 'cpu': return profileCPU(device, packageName, duration, tracePath);
    case 'memory': return profileMemory(device, packageName, duration);
    case 'network': return profileNetwork(device, packageName, duration);
    case 'energy': return profileEnergy(device, packageName, duration);
    default: return { success: false, metrics: {} };
  }
}

async function profileCPU(device: string, packageName: string, duration: number, tracePath: string): Promise<{ success: boolean; metrics: Record<string, number>; tracePath?: string }> {
  try {
    await runProcess('adb', ['-s', device, 'shell', 'am', 'profile', 'start', packageName, '/data/local/tmp/cpu.trace']);
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    await runProcess('adb', ['-s', device, 'shell', 'am', 'profile', 'stop', packageName]);
    await runProcess('adb', ['-s', device, 'pull', '/data/local/tmp/cpu.trace', tracePath]);
    const metrics: Record<string, number> = { cpuUsagePercent: 0, threadCount: 0 };
    const { stdout: cpuInfo } = await runProcess('sh', ['-c', `adb -s ${device} shell top -n 1 | grep ${packageName}`], {
      skipAllowlist: true,
      ignoreExitCode: true,
    });
    const cpuMatch = cpuInfo.match(/(\d+)%/);
    if (cpuMatch) metrics['cpuUsagePercent'] = parseInt(cpuMatch[1] || '0');
    return { success: true, metrics, tracePath };
  } catch {
    return { success: false, metrics: {} };
  }
}

async function profileMemory(device: string, packageName: string, duration: number): Promise<{ success: boolean; metrics: Record<string, number> }> {
  const samples: number[] = [];
  const interval = 1000;
  const iterations = Math.floor((duration * 1000) / interval);
  try {
    for (let i = 0; i < iterations; i++) {
      const { stdout } = await runProcess('sh', ['-c', `adb -s ${device} shell dumpsys meminfo ${packageName} | grep "TOTAL PSS"`], {
        skipAllowlist: true, ignoreExitCode: true,
      });
      const match = stdout.match(/TOTAL PSS:\s+(\d+)/);
      if (match) samples.push(parseInt(match[1] || '0') / 1024);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    if (samples.length === 0) return { success: false, metrics: {} };
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const peak = Math.max(...samples);
    const min = Math.min(...samples);
    return {
      success: true,
      metrics: {
        averageMemoryMB: Math.round(avg),
        peakMemoryMB: Math.round(peak),
        minMemoryMB: Math.round(min),
        memoryGrowthMB: Math.round(peak - min),
      },
    };
  } catch {
    return { success: false, metrics: {} };
  }
}

async function profileNetwork(device: string, packageName: string, duration: number): Promise<{ success: boolean; metrics: Record<string, number> }> {
  try {
    const { stdout: uidInfo } = await runProcess('sh', ['-c', `adb -s ${device} shell dumpsys package ${packageName} | grep userId=`], {
      skipAllowlist: true, ignoreExitCode: true,
    });
    const uidMatch = uidInfo.match(/userId=(\d+)/);
    const uid = uidMatch ? uidMatch[1] : null;
    if (!uid) return { success: false, metrics: {} };
    ensureMatches(uid, /^\d+$/, 'uid');

    const { stdout: initialStats } = await runProcess('sh', ['-c', `adb -s ${device} shell cat /proc/uid_stat/${uid}/tcp_rcv /proc/uid_stat/${uid}/tcp_snd 2>/dev/null || echo "0 0"`], {
      skipAllowlist: true, ignoreExitCode: true,
    });
    const initialNums = initialStats.trim().split('\n').map((s) => parseInt(s) || 0);
    const initialRx = initialNums[0] ?? 0;
    const initialTx = initialNums[1] ?? 0;

    await new Promise((resolve) => setTimeout(resolve, duration * 1000));

    const { stdout: finalStats } = await runProcess('sh', ['-c', `adb -s ${device} shell cat /proc/uid_stat/${uid}/tcp_rcv /proc/uid_stat/${uid}/tcp_snd 2>/dev/null || echo "0 0"`], {
      skipAllowlist: true, ignoreExitCode: true,
    });
    const finalNums = finalStats.trim().split('\n').map((s) => parseInt(s) || 0);
    const finalRx = finalNums[0] ?? 0;
    const finalTx = finalNums[1] ?? 0;

    return {
      success: true,
      metrics: {
        receivedKB: Math.round((finalRx - initialRx) / 1024),
        sentKB: Math.round((finalTx - initialTx) / 1024),
        totalKB: Math.round(((finalRx - initialRx) + (finalTx - initialTx)) / 1024),
      },
    };
  } catch {
    return { success: false, metrics: {} };
  }
}

async function profileEnergy(device: string, packageName: string, duration: number): Promise<{ success: boolean; metrics: Record<string, number> }> {
  try {
    await runProcess('adb', ['-s', device, 'shell', 'dumpsys', 'batterystats', '--reset']);
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    const { stdout } = await runProcess('adb', ['-s', device, 'shell', 'dumpsys', 'batterystats', packageName]);
    const powerMatch = stdout.match(/Estimated power use \(mAh\):\s*([\d.]+)/);
    const wakelocksMatch = stdout.match(/Total wake lock time:\s*(\d+)/);
    return {
      success: true,
      metrics: {
        powerConsumptionmAh: powerMatch ? parseFloat(powerMatch[1] || '0') : 0,
        wakelockTimeMs: wakelocksMatch ? parseInt(wakelocksMatch[1] || '0') : 0,
      },
    };
  } catch {
    return { success: false, metrics: {} };
  }
}

// ============================================
// LeakCanary Integration
// ============================================
export async function checkLeakCanaryResults(device: string, packageName: string) {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');
    const dbPath = `/tmp/leakcanary-${Date.now()}.db`;
    await runProcess('adb', ['-s', device, 'pull', `/data/data/${packageName}/databases/leaks.db`, dbPath], {
      ignoreExitCode: true,
    });
    const leaks: Array<{ className: string; leakTrace: string }> = [];
    return { hasLeaks: leaks.length > 0, leaks };
  } catch {
    return { hasLeaks: false, leaks: [] };
  }
}

// ============================================
// App Management
// ============================================
export async function installApk(device: string, apkPath: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    await runProcess('adb', ['-s', device, 'install', '-r', apkPath]);
    return true;
  } catch {
    return false;
  }
}

export async function uninstallApp(device: string, packageName: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');
    await runProcess('adb', ['-s', device, 'uninstall', packageName]);
    return true;
  } catch {
    return false;
  }
}

export async function launchApp(device: string, packageName: string, activity?: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');
    const activityArg = activity || `${packageName}.MainActivity`;
    ensureMatches(activityArg, ACTIVITY_REGEX, 'activity');
    await runProcess('adb', ['-s', device, 'shell', 'am', 'start', '-n', `${packageName}/${activityArg}`]);
    return true;
  } catch {
    return false;
  }
}

export async function forceStopApp(device: string, packageName: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');
    await runProcess('adb', ['-s', device, 'shell', 'am', 'force-stop', packageName]);
    return true;
  } catch {
    return false;
  }
}

export async function clearAppData(device: string, packageName: string): Promise<boolean> {
  try {
    ensureMatches(device, ID_ALLOWLIST, 'device');
    ensureMatches(packageName, PACKAGE_NAME_REGEX, 'packageName');
    await runProcess('adb', ['-s', device, 'shell', 'pm', 'clear', packageName]);
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
    ensureMatches(device, ID_ALLOWLIST, 'device');
    // Use sh -c with a properly-quoted, no-meta path. We already validated `device`.
    // For outputPath we don't validate (user-supplied output paths can contain spaces),
    // but we pass through `sh -c` with a properly-escaped path to avoid injection.
    const safePath = outputPath.replace(/'/g, "'\\''");
    await runProcess('sh', ['-c', `adb -s ${device} exec-out screencap -p > '${safePath}'`], {
      skipAllowlist: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function startRecording(device: string, outputPath: string, maxDuration = 180): Promise<{
  stop: () => Promise<void>;
}> {
  ensureMatches(device, ID_ALLOWLIST, 'device');
  const remoteFile = '/sdcard/screenrecord.mp4';
  // Background spawn with argv array.
  const child = spawn('adb', ['-s', device, 'shell', 'screenrecord', '--time-limit', String(maxDuration), remoteFile], {
    shell: false,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  return {
    stop: async () => {
      await runProcess('adb', ['-s', device, 'shell', 'pkill', '-INT', 'screenrecord'], { ignoreExitCode: true }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await runProcess('adb', ['-s', device, 'pull', remoteFile, outputPath], { ignoreExitCode: true }).catch(() => {});
      await runProcess('adb', ['-s', device, 'shell', 'rm', remoteFile], { ignoreExitCode: true }).catch(() => {});
    },
  };
}

export default {
  listDevices,
  listEmulators,
  startEmulator,
  stopEmulator,
  runGradleTests,
  runEspressoTests,
  runUIAutomator,
  runProfiler,
  checkLeakCanaryResults,
  installApk,
  uninstallApp,
  launchApp,
  forceStopApp,
  clearAppData,
  takeScreenshot,
  startRecording,
};
