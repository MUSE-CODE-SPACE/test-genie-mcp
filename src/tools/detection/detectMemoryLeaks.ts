// ============================================
// Detect Memory Leaks Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  DetectedIssue,
  MemoryLeakInfo,
  Platform,
  AppStructure,
  ComponentInfo,
} from '../../types.js';
import { getAllFiles, detectPotentialMemoryLeaks } from '../../utils/codeParser.js';
import { saveIssues } from '../../storage/index.js';

interface DetectMemoryLeaksParams {
  appStructure: AppStructure;
  analysisType?: 'static' | 'dynamic' | 'both';
  thresholds?: {
    minLeakSizeMB?: number;
    maxRetainCount?: number;
  };
}

interface DetectMemoryLeaksResult {
  issues: MemoryLeakInfo[];
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  recommendations: string[];
}

export function detectMemoryLeaks(params: DetectMemoryLeaksParams): DetectMemoryLeaksResult {
  const {
    appStructure,
    analysisType = 'both',
    thresholds = {},
  } = params;

  const issues: MemoryLeakInfo[] = [];

  // Static analysis
  if (analysisType === 'static' || analysisType === 'both') {
    const staticIssues = performStaticAnalysis(appStructure);
    issues.push(...staticIssues);
  }

  // Dynamic analysis (simulated)
  if (analysisType === 'dynamic' || analysisType === 'both') {
    const dynamicIssues = performDynamicAnalysis(appStructure, thresholds);
    issues.push(...dynamicIssues);
  }

  // Save issues
  saveIssues(issues, appStructure.projectPath);

  // Generate summary
  const summary = {
    totalIssues: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
  };

  return {
    issues,
    summary,
    recommendations: generateRecommendations(issues, appStructure),
  };
}

function performStaticAnalysis(appStructure: AppStructure): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];
  const extensions = getExtensions(appStructure.platform);
  const files = getAllFiles(appStructure.projectPath, extensions);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const fileIssues = analyzeFileForMemoryLeaks(file, content, appStructure.platform);
      issues.push(...fileIssues);
    } catch {
      // Skip files that can't be read
    }
  }

  return issues;
}

function analyzeFileForMemoryLeaks(filePath: string, content: string, platform: Platform): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];
  const lines = content.split('\n');

  // Platform-specific patterns
  switch (platform) {
    case 'ios':
      issues.push(...analyzeSwiftMemoryLeaks(filePath, content, lines));
      break;
    case 'android':
      issues.push(...analyzeKotlinMemoryLeaks(filePath, content, lines));
      break;
    case 'flutter':
      issues.push(...analyzeDartMemoryLeaks(filePath, content, lines));
      break;
    case 'react-native':
    case 'web':
      issues.push(...analyzeReactMemoryLeaks(filePath, content, lines));
      break;
  }

  return issues;
}

function analyzeSwiftMemoryLeaks(filePath: string, content: string, lines: string[]): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];

  // Check for NotificationCenter without removeObserver
  if (content.includes('NotificationCenter.default.addObserver') && !content.includes('removeObserver')) {
    const lineNum = lines.findIndex(l => l.includes('addObserver')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'high',
      title: 'NotificationCenter observer not removed',
      description: 'NotificationCenter observer is added but never removed, causing a memory leak',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'NotificationCenter',
      suggestion: 'Add removeObserver in deinit or appropriate cleanup method',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for Timer without invalidate
  if (content.includes('Timer.scheduledTimer') && !content.includes('invalidate')) {
    const lineNum = lines.findIndex(l => l.includes('Timer.scheduledTimer')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'high',
      title: 'Timer not invalidated',
      description: 'Timer is scheduled but never invalidated, causing a memory leak',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'Timer',
      suggestion: 'Call timer.invalidate() in deinit or when timer is no longer needed',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for closures without weak self
  const closurePattern = /\{[^}]*self\.[^}]*\}/g;
  let match;
  while ((match = closurePattern.exec(content)) !== null) {
    const matchStart = content.substring(0, match.index).split('\n').length;
    const closureContent = match[0];

    if (!closureContent.includes('[weak self]') && !closureContent.includes('[unowned self]')) {
      // Check if this is an escaping closure
      const beforeClosure = content.substring(Math.max(0, match.index - 100), match.index);
      if (beforeClosure.includes('Task') || beforeClosure.includes('async') ||
          beforeClosure.includes('completion') || beforeClosure.includes('@escaping')) {
        issues.push({
          id: uuidv4(),
          type: 'retain_cycle',
          severity: 'medium',
          title: 'Potential retain cycle in closure',
          description: 'Closure captures self strongly which may cause a retain cycle',
          file: filePath,
          line: matchStart,
          code: closureContent.substring(0, 100),
          objectType: 'Closure',
          retainCycle: ['self', 'closure'],
          suggestion: 'Use [weak self] or [unowned self] to prevent retain cycle',
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  // Check for delegates without weak reference
  const delegatePattern = /var\s+(\w*delegate\w*)\s*:\s*(\w+)\s*\??\s*(?!=.*weak)/gi;
  while ((match = delegatePattern.exec(content)) !== null) {
    if (!content.substring(Math.max(0, match.index - 10), match.index).includes('weak')) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({
        id: uuidv4(),
        type: 'retain_cycle',
        severity: 'medium',
        title: 'Delegate should be weak',
        description: 'Delegate property should be weak to prevent retain cycle',
        file: filePath,
        line: lineNum,
        code: match[0],
        objectType: 'Delegate',
        retainCycle: ['self', match[1] ?? 'delegate'],
        suggestion: 'Make delegate property weak: weak var delegate: DelegateProtocol?',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return issues;
}

function analyzeKotlinMemoryLeaks(filePath: string, content: string, lines: string[]): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];

  // Check for BroadcastReceiver without unregister
  if (content.includes('registerReceiver') && !content.includes('unregisterReceiver')) {
    const lineNum = lines.findIndex(l => l.includes('registerReceiver')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'high',
      title: 'BroadcastReceiver not unregistered',
      description: 'BroadcastReceiver is registered but never unregistered',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'BroadcastReceiver',
      suggestion: 'Call unregisterReceiver in onPause or onDestroy',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for Handler without removeCallbacks
  if (content.includes('Handler') && content.includes('postDelayed') && !content.includes('removeCallbacks')) {
    const lineNum = lines.findIndex(l => l.includes('postDelayed')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'medium',
      title: 'Handler callbacks not removed',
      description: 'Handler postDelayed is used but callbacks are not removed',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'Handler',
      suggestion: 'Call handler.removeCallbacksAndMessages(null) in onDestroy',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for static Context reference
  if (content.includes('companion object') && (content.includes('Context') || content.includes('Activity'))) {
    const lineNum = lines.findIndex(l => l.includes('companion object')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'critical',
      title: 'Static Context reference',
      description: 'Context or Activity stored in static field causes memory leak',
      file: filePath,
      line: lineNum,
      objectType: 'Context',
      suggestion: 'Use applicationContext instead of activity context, or avoid static references',
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

function analyzeDartMemoryLeaks(filePath: string, content: string, lines: string[]): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];

  // Check for StreamSubscription without cancel
  if (content.includes('StreamSubscription') && !content.includes('cancel()')) {
    const lineNum = lines.findIndex(l => l.includes('StreamSubscription')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'unclosed_resource',
      severity: 'high',
      title: 'StreamSubscription not cancelled',
      description: 'StreamSubscription is created but never cancelled',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'StreamSubscription',
      suggestion: 'Call subscription.cancel() in dispose method',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for AnimationController without dispose
  if (content.includes('AnimationController') && !content.includes('dispose()')) {
    const lineNum = lines.findIndex(l => l.includes('AnimationController')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'unclosed_resource',
      severity: 'high',
      title: 'AnimationController not disposed',
      description: 'AnimationController is created but never disposed',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'AnimationController',
      suggestion: 'Call controller.dispose() in dispose method',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for TextEditingController without dispose
  if (content.includes('TextEditingController()') && !content.includes('.dispose()')) {
    const lineNum = lines.findIndex(l => l.includes('TextEditingController')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'unclosed_resource',
      severity: 'medium',
      title: 'TextEditingController not disposed',
      description: 'TextEditingController should be disposed when no longer needed',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'TextEditingController',
      suggestion: 'Call controller.dispose() in dispose method',
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

function analyzeReactMemoryLeaks(filePath: string, content: string, lines: string[]): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];

  // Check for useEffect without cleanup
  const effectPattern = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  let match;

  while ((match = effectPattern.exec(content)) !== null) {
    const effectBody = match[1] || '';
    const hasCleanup = effectBody.includes('return');
    const lineNum = content.substring(0, match.index).split('\n').length;

    // Check for subscriptions without cleanup
    const needsCleanup =
      effectBody.includes('addEventListener') ||
      effectBody.includes('subscribe') ||
      effectBody.includes('setInterval') ||
      effectBody.includes('setTimeout') ||
      effectBody.includes('WebSocket');

    if (needsCleanup && !hasCleanup) {
      let objectType = 'Unknown';
      if (effectBody.includes('addEventListener')) objectType = 'EventListener';
      else if (effectBody.includes('subscribe')) objectType = 'Subscription';
      else if (effectBody.includes('setInterval')) objectType = 'Interval';
      else if (effectBody.includes('setTimeout')) objectType = 'Timeout';
      else if (effectBody.includes('WebSocket')) objectType = 'WebSocket';

      issues.push({
        id: uuidv4(),
        type: 'memory_leak',
        severity: 'high',
        title: `useEffect missing cleanup for ${objectType}`,
        description: `useEffect creates ${objectType} but does not clean it up`,
        file: filePath,
        line: lineNum,
        code: effectBody.substring(0, 100),
        objectType,
        suggestion: `Add return function to clean up ${objectType}`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Check for event listeners without removal
  if (content.includes('addEventListener') && !content.includes('removeEventListener')) {
    const lineNum = lines.findIndex(l => l.includes('addEventListener')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'high',
      title: 'Event listener not removed',
      description: 'Event listener is added but never removed',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'EventListener',
      suggestion: 'Add removeEventListener in cleanup function',
      detectedAt: new Date().toISOString(),
    });
  }

  // Check for setInterval without clearInterval
  if (content.includes('setInterval') && !content.includes('clearInterval')) {
    const lineNum = lines.findIndex(l => l.includes('setInterval')) + 1;
    issues.push({
      id: uuidv4(),
      type: 'memory_leak',
      severity: 'high',
      title: 'Interval not cleared',
      description: 'setInterval is used but interval is never cleared',
      file: filePath,
      line: lineNum,
      code: lines[lineNum - 1]?.trim(),
      objectType: 'Interval',
      suggestion: 'Store interval ID and call clearInterval in cleanup',
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

function performDynamicAnalysis(
  appStructure: AppStructure,
  thresholds: { minLeakSizeMB?: number; maxRetainCount?: number }
): MemoryLeakInfo[] {
  const issues: MemoryLeakInfo[] = [];
  const { minLeakSizeMB = 5, maxRetainCount = 10 } = thresholds;

  // Simulate dynamic analysis results
  // In real implementation, this would use platform-specific profiling tools

  // Check components with complex lifecycle
  for (const component of appStructure.components) {
    const hasSubscriptions = component.lifecycle.some(l => l.subscriptions.length > 0);
    const hasCleanup = component.lifecycle.some(l => l.hasCleanup);

    if (hasSubscriptions && !hasCleanup) {
      issues.push({
        id: uuidv4(),
        type: 'memory_leak',
        severity: 'high',
        title: `${component.name} - Missing lifecycle cleanup`,
        description: `Component ${component.name} has subscriptions but no cleanup in lifecycle`,
        file: component.path,
        line: 1,
        objectType: component.type,
        suggestion: 'Add cleanup logic in appropriate lifecycle method',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return issues;
}

function getExtensions(platform: Platform): string[] {
  switch (platform) {
    case 'ios': return ['.swift', '.m'];
    case 'android': return ['.kt', '.java'];
    case 'flutter': return ['.dart'];
    case 'react-native':
    case 'web': return ['.tsx', '.ts', '.jsx', '.js'];
    default: return ['.ts', '.js'];
  }
}

function generateRecommendations(issues: MemoryLeakInfo[], appStructure: AppStructure): string[] {
  const recommendations: string[] = [];
  const issueTypes = new Set(issues.map(i => i.type));

  if (issueTypes.has('memory_leak')) {
    recommendations.push('Review all subscription and listener registrations - ensure they are properly cleaned up');
  }

  if (issueTypes.has('retain_cycle')) {
    recommendations.push('Use weak references for delegates and closures that capture self');
  }

  if (issueTypes.has('unclosed_resource')) {
    recommendations.push('Implement proper dispose/cleanup methods for all controllers and streams');
  }

  if (issues.length > 10) {
    recommendations.push('Consider implementing a centralized subscription management pattern');
  }

  // Platform-specific recommendations
  switch (appStructure.platform) {
    case 'ios':
      recommendations.push('Use Instruments Leaks tool for runtime memory analysis');
      break;
    case 'android':
      recommendations.push('Use Android Studio Memory Profiler and LeakCanary for runtime detection');
      break;
    case 'flutter':
      recommendations.push('Use Flutter DevTools Memory view for runtime analysis');
      break;
    case 'react-native':
      recommendations.push('Use Flipper Memory plugin for runtime memory analysis');
      break;
  }

  return recommendations;
}

export default detectMemoryLeaks;
