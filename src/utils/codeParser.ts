// ============================================
// Code Parser Utilities
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { Platform, Language, ComponentInfo, ScreenInfo, ApiInfo, LifecycleInfo, StateInfo, PropInfo } from '../types.js';

// Detect platform from project structure
export function detectPlatform(projectPath: string): Platform {
  const files = fs.readdirSync(projectPath);

  // iOS
  if (files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) {
    return 'ios';
  }

  // Android
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) {
    return 'android';
  }

  // Flutter
  if (files.includes('pubspec.yaml')) {
    return 'flutter';
  }

  // React Native
  if (files.includes('metro.config.js') || files.includes('app.json')) {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.dependencies?.['react-native']) {
        return 'react-native';
      }
    }
  }

  // Web
  return 'web';
}

// Detect language from platform
export function detectLanguage(platform: Platform, projectPath: string): Language {
  switch (platform) {
    case 'ios':
      // Check for Swift or Objective-C
      const iosFiles = getAllFiles(projectPath, ['.swift', '.m', '.mm']);
      const swiftCount = iosFiles.filter(f => f.endsWith('.swift')).length;
      const objcCount = iosFiles.filter(f => f.endsWith('.m') || f.endsWith('.mm')).length;
      return swiftCount >= objcCount ? 'swift' : 'swift'; // Default to Swift

    case 'android':
      const androidFiles = getAllFiles(projectPath, ['.kt', '.java']);
      const kotlinCount = androidFiles.filter(f => f.endsWith('.kt')).length;
      const javaCount = androidFiles.filter(f => f.endsWith('.java')).length;
      return kotlinCount >= javaCount ? 'kotlin' : 'java';

    case 'flutter':
      return 'dart';

    case 'react-native':
    case 'web':
      const webFiles = getAllFiles(projectPath, ['.ts', '.tsx', '.js', '.jsx']);
      const tsCount = webFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx')).length;
      return tsCount > 0 ? 'typescript' : 'javascript';

    default:
      return 'typescript';
  }
}

// Get all files with specific extensions
export function getAllFiles(dir: string, extensions: string[], maxDepth = 10): string[] {
  const results: string[] = [];

  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) return;

    try {
      const items = fs.readdirSync(currentDir);

      for (const item of items) {
        // Skip common non-source directories
        if (['node_modules', '.git', 'build', 'dist', 'Pods', '.gradle', '.idea', 'DerivedData'].includes(item)) {
          continue;
        }

        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (extensions.some(ext => item.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  walk(dir, 0);
  return results;
}

// Parse React/React Native component
export function parseReactComponent(filePath: string, content: string): ComponentInfo | null {
  const name = path.basename(filePath, path.extname(filePath));

  // Extract props
  const props: PropInfo[] = [];
  const propsMatch = content.match(/interface\s+\w*Props\s*\{([^}]+)\}/s);
  if (propsMatch && propsMatch[1]) {
    const propsContent = propsMatch[1];
    const propRegex = /(\w+)(\?)?:\s*([^;,\n]+)/g;
    let match;
    while ((match = propRegex.exec(propsContent)) !== null) {
      props.push({
        name: match[1] ?? '',
        type: match[3]?.trim() ?? 'unknown',
        required: !match[2],
      });
    }
  }

  // Extract state (useState hooks)
  const state: StateInfo[] = [];
  const stateRegex = /useState[<\(]([^>)]+)[>)]\s*\(\s*([^)]*)\s*\)/g;
  let stateMatch;
  while ((stateMatch = stateRegex.exec(content)) !== null) {
    state.push({
      name: 'state',
      type: stateMatch[1] ?? 'unknown',
      initialValue: stateMatch[2],
    });
  }

  // Extract lifecycle (useEffect hooks)
  const lifecycle: LifecycleInfo[] = [];
  const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  let effectMatch;
  while ((effectMatch = effectRegex.exec(content)) !== null) {
    const effectBody = effectMatch[1] ?? '';
    const hasCleanup = effectBody.includes('return');
    const subscriptions: string[] = [];

    // Detect subscriptions
    if (effectBody.includes('subscribe')) subscriptions.push('subscription');
    if (effectBody.includes('addEventListener')) subscriptions.push('eventListener');
    if (effectBody.includes('setInterval')) subscriptions.push('interval');
    if (effectBody.includes('setTimeout')) subscriptions.push('timeout');

    lifecycle.push({
      method: 'useEffect',
      hasCleanup,
      subscriptions,
    });
  }

  // Extract dependencies
  const dependencies: string[] = [];
  const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch;
  while ((importMatch = importRegex.exec(content)) !== null) {
    dependencies.push(importMatch[1] ?? '');
  }

  return {
    name,
    path: filePath,
    type: 'component',
    props,
    state,
    lifecycle,
    dependencies,
  };
}

// Parse Swift view/controller
export function parseSwiftComponent(filePath: string, content: string): ComponentInfo | null {
  const name = path.basename(filePath, '.swift');

  // Extract properties
  const props: PropInfo[] = [];
  const propRegex = /@(?:State|Binding|Published|ObservedObject)\s+(?:var|let)\s+(\w+):\s*([^\n=]+)/g;
  let propMatch;
  while ((propMatch = propRegex.exec(content)) !== null) {
    props.push({
      name: propMatch[1] ?? '',
      type: propMatch[2]?.trim() ?? 'unknown',
      required: true,
    });
  }

  // Extract state
  const state: StateInfo[] = [];
  const stateRegex = /@State\s+(?:private\s+)?var\s+(\w+)(?::\s*([^\n=]+))?(?:\s*=\s*([^\n]+))?/g;
  let stateMatch;
  while ((stateMatch = stateRegex.exec(content)) !== null) {
    state.push({
      name: stateMatch[1] ?? '',
      type: stateMatch[2]?.trim() ?? 'inferred',
      initialValue: stateMatch[3]?.trim(),
    });
  }

  // Detect lifecycle
  const lifecycle: LifecycleInfo[] = [];
  if (content.includes('.onAppear')) {
    lifecycle.push({ method: 'onAppear', hasCleanup: false, subscriptions: [] });
  }
  if (content.includes('.onDisappear')) {
    lifecycle.push({ method: 'onDisappear', hasCleanup: true, subscriptions: [] });
  }
  if (content.includes('viewDidLoad')) {
    lifecycle.push({ method: 'viewDidLoad', hasCleanup: false, subscriptions: [] });
  }
  if (content.includes('deinit')) {
    lifecycle.push({ method: 'deinit', hasCleanup: true, subscriptions: [] });
  }

  // Check for memory leak patterns
  const subscriptions: string[] = [];
  if (content.includes('NotificationCenter') && !content.includes('removeObserver')) {
    subscriptions.push('NotificationCenter');
  }
  if (content.includes('Timer.scheduledTimer') && !content.includes('invalidate')) {
    subscriptions.push('Timer');
  }

  if (subscriptions.length > 0 && lifecycle.length > 0) {
    lifecycle[0]!.subscriptions = subscriptions;
  }

  return {
    name,
    path: filePath,
    type: content.includes('View') ? 'view' : 'component',
    props,
    state,
    lifecycle,
    dependencies: [],
  };
}

// Parse Kotlin/Android component
export function parseKotlinComponent(filePath: string, content: string): ComponentInfo | null {
  const name = path.basename(filePath, '.kt');

  const props: PropInfo[] = [];
  const state: StateInfo[] = [];

  // Extract properties
  const propRegex = /(?:val|var)\s+(\w+):\s*([^\n=]+)(?:\s*=\s*([^\n]+))?/g;
  let propMatch;
  while ((propMatch = propRegex.exec(content)) !== null) {
    props.push({
      name: propMatch[1] ?? '',
      type: propMatch[2]?.trim() ?? 'unknown',
      required: !propMatch[3],
    });
  }

  // Extract state (MutableState, LiveData, StateFlow)
  const stateRegex = /(?:mutableStateOf|MutableLiveData|MutableStateFlow)[<\(]([^>)]+)/g;
  let stateMatch;
  while ((stateMatch = stateRegex.exec(content)) !== null) {
    state.push({
      name: 'state',
      type: stateMatch[1] ?? 'unknown',
    });
  }

  // Detect lifecycle
  const lifecycle: LifecycleInfo[] = [];
  const lifecycleMethods = ['onCreate', 'onStart', 'onResume', 'onPause', 'onStop', 'onDestroy'];
  for (const method of lifecycleMethods) {
    if (content.includes(`override fun ${method}`)) {
      lifecycle.push({
        method,
        hasCleanup: method === 'onDestroy',
        subscriptions: [],
      });
    }
  }

  return {
    name,
    path: filePath,
    type: content.includes('Activity') ? 'view' : content.includes('Fragment') ? 'view' : 'component',
    props,
    state,
    lifecycle,
    dependencies: [],
  };
}

// Parse Flutter/Dart widget
export function parseDartWidget(filePath: string, content: string): ComponentInfo | null {
  const name = path.basename(filePath, '.dart');

  const props: PropInfo[] = [];
  const state: StateInfo[] = [];

  // Extract constructor parameters
  const constructorRegex = /(?:required\s+)?(?:this\.)?(\w+)(?:,|\})/g;
  let constructorMatch;
  while ((constructorMatch = constructorRegex.exec(content)) !== null) {
    const propName = constructorMatch[1];
    if (propName && !['key', 'child', 'children'].includes(propName)) {
      props.push({
        name: propName,
        type: 'dynamic',
        required: content.includes(`required this.${propName}`),
      });
    }
  }

  // Extract state variables
  const stateRegex = /(?:late\s+)?(\w+)\s+_(\w+)/g;
  let stateMatch;
  while ((stateMatch = stateRegex.exec(content)) !== null) {
    state.push({
      name: stateMatch[2] ?? '',
      type: stateMatch[1] ?? 'dynamic',
    });
  }

  // Detect lifecycle
  const lifecycle: LifecycleInfo[] = [];
  if (content.includes('initState')) {
    lifecycle.push({ method: 'initState', hasCleanup: false, subscriptions: [] });
  }
  if (content.includes('dispose')) {
    lifecycle.push({ method: 'dispose', hasCleanup: true, subscriptions: [] });
  }
  if (content.includes('didChangeDependencies')) {
    lifecycle.push({ method: 'didChangeDependencies', hasCleanup: false, subscriptions: [] });
  }

  return {
    name,
    path: filePath,
    type: 'widget',
    props,
    state,
    lifecycle,
    dependencies: [],
  };
}

// Parse API calls from code
export function parseApiCalls(content: string): ApiInfo[] {
  const apis: ApiInfo[] = [];

  // Fetch/Axios patterns
  const fetchRegex = /(?:fetch|axios)\s*\(\s*['"`]([^'"`]+)['"`](?:,\s*\{[^}]*method:\s*['"](\w+)['"])?/g;
  let fetchMatch;
  while ((fetchMatch = fetchRegex.exec(content)) !== null) {
    apis.push({
      endpoint: fetchMatch[1] ?? '',
      method: (fetchMatch[2]?.toUpperCase() as ApiInfo['method']) || 'GET',
      path: fetchMatch[1] ?? '',
      errorHandling: content.includes('.catch') || content.includes('try'),
    });
  }

  // URLSession patterns (Swift)
  const urlSessionRegex = /URLSession.*request.*url.*['"`]([^'"`]+)['"`]/g;
  let urlMatch;
  while ((urlMatch = urlSessionRegex.exec(content)) !== null) {
    apis.push({
      endpoint: urlMatch[1] ?? '',
      method: 'GET',
      path: urlMatch[1] ?? '',
      errorHandling: content.includes('catch') || content.includes('error'),
    });
  }

  // Retrofit patterns (Kotlin)
  const retrofitRegex = /@(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let retrofitMatch;
  while ((retrofitMatch = retrofitRegex.exec(content)) !== null) {
    apis.push({
      endpoint: retrofitMatch[2] ?? '',
      method: retrofitMatch[1] as ApiInfo['method'],
      path: retrofitMatch[2] ?? '',
      errorHandling: true,
    });
  }

  // Dio patterns (Dart)
  const dioRegex = /dio\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;
  let dioMatch;
  while ((dioMatch = dioRegex.exec(content)) !== null) {
    apis.push({
      endpoint: dioMatch[2] ?? '',
      method: dioMatch[1]?.toUpperCase() as ApiInfo['method'],
      path: dioMatch[2] ?? '',
      errorHandling: content.includes('catch') || content.includes('onError'),
    });
  }

  return apis;
}

// Detect potential memory leaks
export function detectPotentialMemoryLeaks(content: string, platform: Platform): string[] {
  const issues: string[] = [];

  if (platform === 'ios') {
    // Swift memory leak patterns
    if (content.includes('NotificationCenter.default.addObserver') && !content.includes('removeObserver')) {
      issues.push('NotificationCenter observer not removed');
    }
    if (content.includes('Timer.scheduledTimer') && !content.includes('invalidate')) {
      issues.push('Timer not invalidated');
    }
    if (content.includes('[weak self]') === false && content.includes('self.') && content.includes('closure')) {
      issues.push('Potential strong reference cycle in closure');
    }
  }

  if (platform === 'react-native' || platform === 'web') {
    // React memory leak patterns
    if (content.includes('addEventListener') && !content.includes('removeEventListener')) {
      issues.push('Event listener not removed');
    }
    if (content.includes('setInterval') && !content.includes('clearInterval')) {
      issues.push('Interval not cleared');
    }
    if (content.includes('setTimeout') && !content.includes('clearTimeout')) {
      issues.push('Timeout not cleared');
    }
    if (content.includes('subscribe') && !content.includes('unsubscribe')) {
      issues.push('Subscription not unsubscribed');
    }
    if (content.includes('useEffect') && !content.includes('return')) {
      issues.push('useEffect cleanup function missing');
    }
  }

  if (platform === 'android') {
    // Kotlin/Android memory leak patterns
    if (content.includes('registerReceiver') && !content.includes('unregisterReceiver')) {
      issues.push('BroadcastReceiver not unregistered');
    }
    if (content.includes('addCallback') && !content.includes('removeCallback')) {
      issues.push('Callback not removed');
    }
  }

  if (platform === 'flutter') {
    // Dart/Flutter memory leak patterns
    if (content.includes('addListener') && !content.includes('removeListener')) {
      issues.push('Listener not removed');
    }
    if (content.includes('StreamSubscription') && !content.includes('cancel')) {
      issues.push('StreamSubscription not cancelled');
    }
    if (content.includes('AnimationController') && !content.includes('dispose')) {
      issues.push('AnimationController not disposed');
    }
  }

  return issues;
}

// Generate diff between two code snippets
export function generateDiff(original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [];
  const maxLen = Math.max(originalLines.length, modifiedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === modLine) {
      diff.push(`  ${origLine ?? ''}`);
    } else if (origLine && !modLine) {
      diff.push(`- ${origLine}`);
    } else if (!origLine && modLine) {
      diff.push(`+ ${modLine}`);
    } else {
      diff.push(`- ${origLine}`);
      diff.push(`+ ${modLine}`);
    }
  }

  return diff.join('\n');
}
