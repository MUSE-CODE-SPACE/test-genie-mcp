// ============================================
// Analyze App Structure Tool
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import {
  Platform,
  Language,
  AppStructure,
  ScreenInfo,
  ComponentInfo,
  ApiInfo,
  StateManagementInfo,
  DependencyInfo,
  NavigationInfo,
} from '../../types.js';
import {
  detectPlatform,
  detectLanguage,
  getAllFiles,
  parseReactComponent,
  parseSwiftComponent,
  parseKotlinComponent,
  parseDartWidget,
  parseApiCalls,
} from '../../utils/codeParser.js';

interface AnalyzeAppStructureParams {
  projectPath: string;
  platform?: Platform;
  depth?: 'shallow' | 'normal' | 'deep';
}

export function analyzeAppStructure(params: AnalyzeAppStructureParams): AppStructure {
  const { projectPath, depth = 'normal' } = params;

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  // Detect platform and language
  const platform = params.platform || detectPlatform(projectPath);
  const language = detectLanguage(platform, projectPath);

  // Get file extensions based on platform
  const extensions = getExtensions(platform);
  const files = getAllFiles(projectPath, extensions);

  // Parse components and screens
  const components: ComponentInfo[] = [];
  const screens: ScreenInfo[] = [];
  const apis: ApiInfo[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Parse component
    const component = parseComponent(file, content, platform);
    if (component) {
      // Determine if it's a screen or component
      if (isScreen(file, content, platform)) {
        screens.push(componentToScreen(component, content, platform));
      } else {
        components.push(component);
      }
    }

    // Parse API calls
    if (depth !== 'shallow') {
      const fileApis = parseApiCalls(content);
      for (const api of fileApis) {
        api.path = file;
        apis.push(api);
      }
    }
  }

  // Detect state management
  const stateManagement = detectStateManagement(projectPath, platform);

  // Get dependencies
  const dependencies = getDependencies(projectPath, platform);

  return {
    projectPath,
    platform,
    language,
    screens,
    components,
    apis,
    stateManagement,
    dependencies,
    analyzedAt: new Date().toISOString(),
  };
}

function getExtensions(platform: Platform): string[] {
  switch (platform) {
    case 'ios':
      return ['.swift', '.m', '.mm'];
    case 'android':
      return ['.kt', '.java'];
    case 'flutter':
      return ['.dart'];
    case 'react-native':
    case 'web':
      return ['.tsx', '.ts', '.jsx', '.js'];
    default:
      return ['.ts', '.js'];
  }
}

function parseComponent(filePath: string, content: string, platform: Platform): ComponentInfo | null {
  switch (platform) {
    case 'ios':
      return parseSwiftComponent(filePath, content);
    case 'android':
      return parseKotlinComponent(filePath, content);
    case 'flutter':
      return parseDartWidget(filePath, content);
    case 'react-native':
    case 'web':
      return parseReactComponent(filePath, content);
    default:
      return null;
  }
}

function isScreen(filePath: string, content: string, platform: Platform): boolean {
  const fileName = path.basename(filePath).toLowerCase();

  // Common naming patterns
  if (fileName.includes('screen') || fileName.includes('page') || fileName.includes('view')) {
    return true;
  }

  switch (platform) {
    case 'ios':
      return content.includes('UIViewController') ||
        content.includes('View: View') ||
        content.includes('@main') ||
        filePath.includes('Screens') ||
        filePath.includes('Views');

    case 'android':
      return content.includes('Activity') ||
        content.includes('Fragment') ||
        content.includes('@Composable') && content.includes('Scaffold');

    case 'flutter':
      return content.includes('Scaffold') ||
        filePath.includes('screens') ||
        filePath.includes('pages');

    case 'react-native':
    case 'web':
      return content.includes('Screen') ||
        content.includes('Page') ||
        filePath.includes('screens') ||
        filePath.includes('pages');

    default:
      return false;
  }
}

function componentToScreen(component: ComponentInfo, content: string, platform: Platform): ScreenInfo {
  const navigation: NavigationInfo[] = [];

  // Detect navigation patterns
  switch (platform) {
    case 'ios':
      if (content.includes('NavigationLink')) {
        const matches = content.matchAll(/NavigationLink.*destination:\s*(\w+)/g);
        for (const match of matches) {
          navigation.push({ target: match[1] ?? '', type: 'push' });
        }
      }
      if (content.includes('presentationMode')) {
        navigation.push({ target: 'previous', type: 'pop' });
      }
      break;

    case 'android':
      const navMatches = content.matchAll(/navigate\(['"]([^'"]+)['"]\)/g);
      for (const match of navMatches) {
        navigation.push({ target: match[1] ?? '', type: 'push' });
      }
      break;

    case 'flutter':
      const flutterNavMatches = content.matchAll(/Navigator\.(push|pop|pushReplacement)\w*.*?['"]?(\w+)['"]?/g);
      for (const match of flutterNavMatches) {
        const type = match[1] === 'pop' ? 'pop' : match[1] === 'pushReplacement' ? 'replace' : 'push';
        navigation.push({ target: match[2] ?? '', type });
      }
      break;

    case 'react-native':
    case 'web':
      const rnNavMatches = content.matchAll(/navigation\.(navigate|goBack|replace)\(['"](\w+)['"]/g);
      for (const match of rnNavMatches) {
        const type = match[1] === 'goBack' ? 'pop' : match[1] === 'replace' ? 'replace' : 'push';
        navigation.push({ target: match[2] ?? '', type });
      }
      break;
  }

  return {
    name: component.name,
    path: component.path,
    type: 'screen',
    components: component.dependencies.filter(d => !d.startsWith('@') && !d.startsWith('.')),
    navigation,
    stateUsage: component.state.map(s => s.name),
  };
}

function detectStateManagement(projectPath: string, platform: Platform): StateManagementInfo | null {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const pubspecPath = path.join(projectPath, 'pubspec.yaml');
  const buildGradlePath = path.join(projectPath, 'app', 'build.gradle');

  if (platform === 'react-native' || platform === 'web') {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps['redux'] || deps['@reduxjs/toolkit']) {
        return { type: 'redux', stores: [], actions: [] };
      }
      if (deps['mobx']) {
        return { type: 'mobx', stores: [], actions: [] };
      }
      if (deps['zustand']) {
        return { type: 'zustand', stores: [], actions: [] };
      }
      if (deps['recoil']) {
        return { type: 'recoil', stores: [], actions: [] };
      }
    }
  }

  if (platform === 'flutter') {
    if (fs.existsSync(pubspecPath)) {
      const pubspec = fs.readFileSync(pubspecPath, 'utf-8');
      if (pubspec.includes('flutter_bloc') || pubspec.includes('bloc')) {
        return { type: 'bloc', stores: [], actions: [] };
      }
      if (pubspec.includes('provider')) {
        return { type: 'provider', stores: [], actions: [] };
      }
      if (pubspec.includes('riverpod')) {
        return { type: 'riverpod', stores: [], actions: [] };
      }
      if (pubspec.includes('get:') || pubspec.includes('getx')) {
        return { type: 'getx', stores: [], actions: [] };
      }
    }
  }

  return null;
}

function getDependencies(projectPath: string, platform: Platform): DependencyInfo[] {
  const dependencies: DependencyInfo[] = [];

  if (platform === 'react-native' || platform === 'web') {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
        dependencies.push({ name, version: version as string, type: 'production' });
      }
      for (const [name, version] of Object.entries(packageJson.devDependencies || {})) {
        dependencies.push({ name, version: version as string, type: 'development' });
      }
    }
  }

  if (platform === 'flutter') {
    const pubspecPath = path.join(projectPath, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      const pubspec = fs.readFileSync(pubspecPath, 'utf-8');
      const depMatches = pubspec.matchAll(/^\s{2}(\w+):\s*[\^~]?([\d.]+)/gm);
      for (const match of depMatches) {
        dependencies.push({
          name: match[1] ?? '',
          version: match[2] ?? '',
          type: 'production',
        });
      }
    }
  }

  if (platform === 'ios') {
    const podfileLockPath = path.join(projectPath, 'Podfile.lock');
    if (fs.existsSync(podfileLockPath)) {
      const podfileLock = fs.readFileSync(podfileLockPath, 'utf-8');
      const podMatches = podfileLock.matchAll(/^\s{2}- (\w+)\s*\(([\d.]+)\)/gm);
      for (const match of podMatches) {
        dependencies.push({
          name: match[1] ?? '',
          version: match[2] ?? '',
          type: 'production',
        });
      }
    }
  }

  return dependencies;
}

export default analyzeAppStructure;
