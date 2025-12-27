// ============================================
// Android Test Platform Integration
// Espresso, UI Automator, Android Profiler
// ============================================

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

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
    const { stdout } = await execAsync('adb devices -l');
    const lines = stdout.split('\n').slice(1); // Skip header
    const devices: AndroidDevice[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(/\s+/);
      const id = parts[0];
      const state = parts[1];

      if (!id || !state) continue;

      // Get device details
      const isEmulator = id.startsWith('emulator');
      let name = 'Unknown';
      let apiLevel = 0;

      try {
        const { stdout: model } = await execAsync(`adb -s ${id} shell getprop ro.product.model`);
        name = model.trim() || 'Unknown';

        const { stdout: sdk } = await execAsync(`adb -s ${id} shell getprop ro.build.version.sdk`);
        apiLevel = parseInt(sdk.trim()) || 0;
      } catch {
        // Device may not be accessible
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
    const { stdout } = await execAsync('emulator -list-avds');
    return stdout.split('\n').filter(line => line.trim());
  } catch {
    return [];
  }
}

export async function startEmulator(avdName: string): Promise<boolean> {
  try {
    // Start emulator in background
    spawn('emulator', ['-avd', avdName, '-no-snapshot-load'], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    // Wait for device to be ready
    await execAsync('adb wait-for-device', { timeout: 120000 });
    await execAsync('adb shell getprop sys.boot_completed', { timeout: 60000 });

    return true;
  } catch {
    return false;
  }
}

export async function stopEmulator(deviceId: string): Promise<boolean> {
  try {
    await execAsync(`adb -s ${deviceId} emu kill`);
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

  let testArg = '';
  if (testClass && testMethod) {
    testArg = `--tests "${testClass}.${testMethod}"`;
  } else if (testClass) {
    testArg = `--tests "${testClass}"`;
  }

  const deviceArg = device ? `-Pandroid.testInstrumentationRunnerArguments.device=${device}` : '';
  const gradlew = path.join(projectPath, 'gradlew');

  const command = `cd "${projectPath}" && chmod +x gradlew && ./gradlew :${module}:testDebugUnitTest ${testArg} ${deviceArg} --info 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const tests = parseGradleTestOutput(stdout);
    const allPassed = tests.every(t => t.passed);

    // Get coverage from JaCoCo if available
    const coverage = await getJacocoCoverage(projectPath, module);

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

function parseGradleTestOutput(output: string): { name: string; passed: boolean; duration: number }[] {
  const tests: { name: string; passed: boolean; duration: number }[] = [];

  // Parse Gradle test output
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

  if (!fs.existsSync(reportPath)) {
    return undefined;
  }

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

  let testArg = '';
  if (testClass && testMethod) {
    testArg = `-Pandroid.testInstrumentationRunnerArguments.class=${testClass}#${testMethod}`;
  } else if (testClass) {
    testArg = `-Pandroid.testInstrumentationRunnerArguments.class=${testClass}`;
  }

  const command = `cd "${projectPath}" && ./gradlew :${module}:connectedDebugAndroidTest ${testArg} --info 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 50 * 1024 * 1024 });

    const tests = parseGradleTestOutput(stdout);
    const screenshots = await pullScreenshots(device || 'default');

    return {
      success: !stdout.includes('FAILED'),
      output: stdout,
      tests,
      screenshots,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || error.message,
      tests: [],
      screenshots: [],
    };
  }
}

async function pullScreenshots(device: string): Promise<string[]> {
  const screenshots: string[] = [];
  const localDir = `/tmp/android-screenshots-${Date.now()}`;
  fs.mkdirSync(localDir, { recursive: true });

  try {
    // Pull screenshots from device
    await execAsync(`adb -s ${device} pull /sdcard/Pictures/Screenshots ${localDir} 2>/dev/null || true`);

    if (fs.existsSync(localDir)) {
      const files = fs.readdirSync(localDir);
      for (const file of files) {
        if (file.endsWith('.png') || file.endsWith('.jpg')) {
          screenshots.push(path.join(localDir, file));
        }
      }
    }
  } catch {
    // No screenshots
  }

  return screenshots;
}

// ============================================
// UI Automator
// ============================================
export async function runUIAutomator(
  device: string,
  testPackage: string,
  testClass?: string
): Promise<{
  success: boolean;
  output: string;
}> {
  const testArg = testClass ? `-e class ${testClass}` : '';
  const command = `adb -s ${device} shell am instrument -w ${testArg} ${testPackage}/androidx.test.runner.AndroidJUnitRunner 2>&1`;

  try {
    const { stdout } = await execAsync(command, { timeout: 300000 });

    return {
      success: stdout.includes('OK') && !stdout.includes('FAILURES'),
      output: stdout,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.message,
    };
  }
}

// ============================================
// Android Profiler Integration
// ============================================
export interface ProfilerConfig {
  type: 'cpu' | 'memory' | 'network' | 'energy';
  duration: number; // in seconds
  packageName: string;
  device: string;
}

export async function runProfiler(config: ProfilerConfig): Promise<{
  success: boolean;
  metrics: Record<string, number>;
  tracePath?: string;
}> {
  const { type, duration, packageName, device } = config;
  const tracePath = `/tmp/android-profile-${Date.now()}.trace`;

  switch (type) {
    case 'cpu':
      return await profileCPU(device, packageName, duration, tracePath);
    case 'memory':
      return await profileMemory(device, packageName, duration);
    case 'network':
      return await profileNetwork(device, packageName, duration);
    case 'energy':
      return await profileEnergy(device, packageName, duration);
    default:
      return { success: false, metrics: {} };
  }
}

async function profileCPU(device: string, packageName: string, duration: number, tracePath: string): Promise<{
  success: boolean;
  metrics: Record<string, number>;
  tracePath?: string;
}> {
  try {
    // Start profiling
    await execAsync(`adb -s ${device} shell am profile start ${packageName} /data/local/tmp/cpu.trace`);

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    // Stop profiling
    await execAsync(`adb -s ${device} shell am profile stop ${packageName}`);

    // Pull trace
    await execAsync(`adb -s ${device} pull /data/local/tmp/cpu.trace ${tracePath}`);

    // Parse metrics (simplified)
    const metrics: Record<string, number> = {
      cpuUsagePercent: 0,
      threadCount: 0,
    };

    // Get CPU usage
    const { stdout: cpuInfo } = await execAsync(`adb -s ${device} shell top -n 1 | grep ${packageName}`);
    const cpuMatch = cpuInfo.match(/(\d+)%/);
    if (cpuMatch) {
      metrics['cpuUsagePercent'] = parseInt(cpuMatch[1] || '0');
    }

    return {
      success: true,
      metrics,
      tracePath,
    };
  } catch (error) {
    return { success: false, metrics: {} };
  }
}

async function profileMemory(device: string, packageName: string, duration: number): Promise<{
  success: boolean;
  metrics: Record<string, number>;
}> {
  const samples: number[] = [];
  const interval = 1000; // 1 second
  const iterations = Math.floor((duration * 1000) / interval);

  try {
    for (let i = 0; i < iterations; i++) {
      const { stdout } = await execAsync(`adb -s ${device} shell dumpsys meminfo ${packageName} | grep "TOTAL PSS"`);
      const match = stdout.match(/TOTAL PSS:\s+(\d+)/);
      if (match) {
        samples.push(parseInt(match[1] || '0') / 1024); // Convert to MB
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    const avgMemory = samples.reduce((a, b) => a + b, 0) / samples.length;
    const peakMemory = Math.max(...samples);
    const minMemory = Math.min(...samples);

    return {
      success: true,
      metrics: {
        averageMemoryMB: Math.round(avgMemory),
        peakMemoryMB: Math.round(peakMemory),
        minMemoryMB: Math.round(minMemory),
        memoryGrowthMB: Math.round(peakMemory - minMemory),
      },
    };
  } catch (error) {
    return { success: false, metrics: {} };
  }
}

async function profileNetwork(device: string, packageName: string, duration: number): Promise<{
  success: boolean;
  metrics: Record<string, number>;
}> {
  try {
    // Get UID for package
    const { stdout: uidInfo } = await execAsync(`adb -s ${device} shell dumpsys package ${packageName} | grep userId=`);
    const uidMatch = uidInfo.match(/userId=(\d+)/);
    const uid = uidMatch ? uidMatch[1] : null;

    if (!uid) {
      return { success: false, metrics: {} };
    }

    // Get initial network stats
    const { stdout: initialStats } = await execAsync(`adb -s ${device} shell cat /proc/uid_stat/${uid}/tcp_rcv /proc/uid_stat/${uid}/tcp_snd 2>/dev/null || echo "0 0"`);
    const [initialRx, initialTx] = initialStats.trim().split('\n').map(s => parseInt(s) || 0);

    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    // Get final network stats
    const { stdout: finalStats } = await execAsync(`adb -s ${device} shell cat /proc/uid_stat/${uid}/tcp_rcv /proc/uid_stat/${uid}/tcp_snd 2>/dev/null || echo "0 0"`);
    const [finalRx, finalTx] = finalStats.trim().split('\n').map(s => parseInt(s) || 0);

    return {
      success: true,
      metrics: {
        receivedKB: Math.round(((finalRx || 0) - (initialRx || 0)) / 1024),
        sentKB: Math.round(((finalTx || 0) - (initialTx || 0)) / 1024),
        totalKB: Math.round((((finalRx || 0) - (initialRx || 0)) + ((finalTx || 0) - (initialTx || 0))) / 1024),
      },
    };
  } catch (error) {
    return { success: false, metrics: {} };
  }
}

async function profileEnergy(device: string, packageName: string, duration: number): Promise<{
  success: boolean;
  metrics: Record<string, number>;
}> {
  try {
    // Reset battery stats
    await execAsync(`adb -s ${device} shell dumpsys batterystats --reset`);

    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    // Get battery stats
    const { stdout } = await execAsync(`adb -s ${device} shell dumpsys batterystats ${packageName}`);

    // Parse power consumption (simplified)
    const powerMatch = stdout.match(/Estimated power use \(mAh\):\s*([\d.]+)/);
    const wakelocksMatch = stdout.match(/Total wake lock time:\s*(\d+)/);

    return {
      success: true,
      metrics: {
        powerConsumptionmAh: powerMatch ? parseFloat(powerMatch[1] || '0') : 0,
        wakelockTimeMs: wakelocksMatch ? parseInt(wakelocksMatch[1] || '0') : 0,
      },
    };
  } catch (error) {
    return { success: false, metrics: {} };
  }
}

// ============================================
// LeakCanary Integration
// ============================================
export async function checkLeakCanaryResults(device: string, packageName: string): Promise<{
  hasLeaks: boolean;
  leaks: Array<{
    className: string;
    leakTrace: string;
  }>;
}> {
  try {
    // Pull LeakCanary database
    const dbPath = `/tmp/leakcanary-${Date.now()}.db`;
    await execAsync(`adb -s ${device} pull /data/data/${packageName}/databases/leaks.db ${dbPath} 2>/dev/null || true`);

    // Parse leaks (simplified - actual implementation would use SQLite)
    const leaks: Array<{ className: string; leakTrace: string }> = [];

    return {
      hasLeaks: leaks.length > 0,
      leaks,
    };
  } catch {
    return { hasLeaks: false, leaks: [] };
  }
}

// ============================================
// App Management
// ============================================
export async function installApk(device: string, apkPath: string): Promise<boolean> {
  try {
    await execAsync(`adb -s ${device} install -r "${apkPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function uninstallApp(device: string, packageName: string): Promise<boolean> {
  try {
    await execAsync(`adb -s ${device} uninstall ${packageName}`);
    return true;
  } catch {
    return false;
  }
}

export async function launchApp(device: string, packageName: string, activity?: string): Promise<boolean> {
  try {
    const activityArg = activity || `${packageName}.MainActivity`;
    await execAsync(`adb -s ${device} shell am start -n ${packageName}/${activityArg}`);
    return true;
  } catch {
    return false;
  }
}

export async function forceStopApp(device: string, packageName: string): Promise<boolean> {
  try {
    await execAsync(`adb -s ${device} shell am force-stop ${packageName}`);
    return true;
  } catch {
    return false;
  }
}

export async function clearAppData(device: string, packageName: string): Promise<boolean> {
  try {
    await execAsync(`adb -s ${device} shell pm clear ${packageName}`);
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
    await execAsync(`adb -s ${device} exec-out screencap -p > "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function startRecording(device: string, outputPath: string, maxDuration = 180): Promise<{
  stop: () => Promise<void>;
}> {
  const remoteFile = '/sdcard/screenrecord.mp4';

  // Start recording in background
  exec(`adb -s ${device} shell screenrecord --time-limit ${maxDuration} ${remoteFile}`);

  return {
    stop: async () => {
      // Stop recording by sending SIGINT
      await execAsync(`adb -s ${device} shell pkill -INT screenrecord`).catch(() => { });
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Pull the recording
      await execAsync(`adb -s ${device} pull ${remoteFile} "${outputPath}"`).catch(() => { });
      // Clean up
      await execAsync(`adb -s ${device} shell rm ${remoteFile}`).catch(() => { });
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
