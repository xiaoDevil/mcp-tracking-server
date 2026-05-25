import path from "node:path";
import fs from "node:fs";
import { parse } from "@ast-grep/napi";
import type { KnownSdk, DetectedSdk, CallSite, FunctionDecl } from "../types.js";
import { IGNORE_PATTERNS, SOURCE_GLOB } from "../constants.js";
import { extractCalleeName } from "./file-utils.js";
import { parseVueSFC } from "./vue-sfc-parser.js";
import fg from "fast-glob";

/**
 * 已知分析 SDK 注册表（纯数据，易扩展）
 */
const KNOWN_SDKS: KnownSdk[] = [
  {
    name: "Sensors (神策)",
    packages: [
      "sa-sdk-javascript",
      "sa-sdk-node",
      "sensorsdata-analytics-js-sdk",
      "sensorsdata-es",
      "sa-sdk-miniprogram",
    ],
    importPatterns: [
      "import $$$ from 'sa-sdk-javascript'",
      "import $$$ from 'sensorsdata-analytics-js-sdk'",
      "import $$$ from 'sensorsdata-es'",
    ],
    rawCallPatterns: [
      "sa.track",
      "sensors.track",
      "sa.login",
      "sensors.login",
      "sa.quick",
      "sensors.quick",
      "sa.register",
      "sensors.register",
      "getApp().sensors.track",
    ],
    trackMethodName: "track",
  },
  {
    name: "GrowingIO",
    packages: ["gio-js-sdk", "@giojs/web-sdk", "growingio"],
    importPatterns: [
      "import $$$ from 'gio-js-sdk'",
      "import $$$ from 'growingio'",
    ],
    rawCallPatterns: [
      'gio("track"',
      "gio('track'",
      "gio.track",
    ],
    trackMethodName: "track",
  },
  {
    name: "Umeng (友盟)",
    packages: ["umeng-analytics", "umtrack-js-sdk", "umtrack"],
    importPatterns: [],
    rawCallPatterns: [
      "UMAnalytics.track",
      "cnzz.track",
      "uma.track",
    ],
    trackMethodName: "track",
  },
  {
    name: "Zhuge (诸葛IO)",
    packages: ["zhuge-sdk-js", "zhuge-js"],
    importPatterns: [
      "import $$$ from 'zhuge-sdk-js'",
      "import $$$ from 'zhuge-js'",
    ],
    rawCallPatterns: [
      "zhuge.track",
      "zhuge.identify",
    ],
    trackMethodName: "track",
  },
  {
    name: "Mixpanel",
    packages: ["mixpanel-browser", "mixpanel"],
    importPatterns: [
      "import $$$ from 'mixpanel-browser'",
      "import $$$ from 'mixpanel'",
    ],
    rawCallPatterns: [
      "mixpanel.track",
      "mixpanel.identify",
      "mixpanel.alias",
    ],
    trackMethodName: "track",
  },
  {
    name: "Google Analytics",
    packages: ["analytics", "ga"],
    importPatterns: [],
    rawCallPatterns: [
      'gtag("event"',
      "gtag('event'",
      'ga("send"',
      "ga('send'",
    ],
    trackMethodName: "event",
  },
];

/**
 * Phase 1: 扫描 package.json 检测 SDK 依赖
 */
function scanPackageJson(projectPath: string): Map<string, string> {
  const result = new Map<string, string>(); // sdkName → packageName

  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) return result;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    for (const [depName] of Object.entries(deps)) {
      for (const sdk of KNOWN_SDKS) {
        if (sdk.packages.includes(depName)) {
          result.set(sdk.name, depName);
        }
      }
    }
  } catch {
    // package.json 解析失败
  }

  return result;
}

/**
 * Phase 2: 在代码中搜索 import/require 模式
 */
function scanImports(
  projectPath: string,
  files: string[]
): Map<string, string[]> {
  const result = new Map<string, string[]>(); // sdkName → files[]

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (content.length === 0) continue;

    // Vue SFC 提取 script
    const ext = path.extname(file);
    if (ext === ".vue") {
      const { script } = parseVueSFC(content);
      if (!script) continue;
      content = script.code;
    }

    for (const sdk of KNOWN_SDKS) {
      for (const pattern of sdk.packages) {
        // 检查 import/require 语句中是否包含该包名（锚定行首避免匹配字符串数据）
        const importRegex = new RegExp(
          `^\\s*(?:import\\s+[^;]*|const\\s+[^=]*=\\s*require\\s*\\(\\s*)['"\`]${escapeRegex(pattern)}['"\`]`,
          "m"
        );
        if (importRegex.test(content)) {
          const existing = result.get(sdk.name) || [];
          const relative = path.relative(projectPath, file).replace(/\\/g, "/");
          if (!existing.includes(relative)) {
            existing.push(relative);
          }
          result.set(sdk.name, existing);
        }
      }
    }
  }

  return result;
}

/**
 * Phase 3: 在调用图中确认 SDK 的原始方法被使用
 */
function confirmRawCalls(
  sdk: KnownSdk,
  callGraph: Map<string, CallSite[]>
): string[] {
  const confirmed: string[] = [];

  for (const pattern of sdk.rawCallPatterns) {
    const calleeName = extractCalleeName(pattern);
    const callSites = callGraph.get(calleeName);
    if (callSites && callSites.length > 0) {
      confirmed.push(calleeName);
    }
  }

  return confirmed;
}

/**
 * 兜底：从调用图中发现跟踪相关方法（无需识别具体 SDK）
 *
 * 匹配策略：callee 名称含 track/event 等关键词，且不在排除列表中
 * Level 0 筛选：只取未在项目中定义的方法（外部 SDK 调用），项目定义的由链追踪自动发现
 */
const TRACKING_KEYWORDS = /\btrack(?!.*Report|.*Shared)|\$track|logEvent|sendEvent|capture|analytics\b/i;
const EXCLUDE_PREFIXES = [
  "document.", "window.", "console.", "Math.", "JSON.",
  "Object.", "Array.", "String.", "Number.", "Promise.",
  "process.", "require.", "module.", "exports.",
  "el.", "element.", "node.", "div.", "bridge.",
];

function detectTrackingMethodsFromCallGraph(
  callGraph: Map<string, CallSite[]>,
  functionIndex: Map<string, FunctionDecl[]>
): DetectedSdk | null {
  const foundMethods = new Map<string, number>();

  for (const [calleeName, sites] of callGraph) {
    if (EXCLUDE_PREFIXES.some((p) => calleeName.startsWith(p))) continue;
    if (!TRACKING_KEYWORDS.test(calleeName)) continue;
    foundMethods.set(calleeName, sites.length);
  }

  if (foundMethods.size === 0) return null;

  // 区分外部方法和项目内部方法
  const externalMethods: string[] = [];
  const internalMethods: string[] = [];

  for (const [name] of foundMethods) {
    const shortName = name.includes(".") ? name.split(".").pop()! : name;
    if (functionIndex.has(shortName) || functionIndex.has(name)) {
      internalMethods.push(name);
    } else {
      externalMethods.push(name);
    }
  }

  // Level 0 种子：
  // - 有外部方法时用外部方法（SDK 原始调用）
  // - 全是内部方法时，说明项目自己封装了埋点方法，全部纳入作为种子
  let seeds: string[];
  if (externalMethods.length > 0) {
    seeds = externalMethods;
  } else {
    seeds = [...foundMethods.keys()];
  }

  const syntheticSdk: KnownSdk = {
    name: "Detected Tracking Methods",
    packages: [],
    importPatterns: [],
    rawCallPatterns: seeds,
    trackMethodName: seeds[0]?.split(".").pop() || "track",
  };

  return {
    sdk: syntheticSdk,
    importFiles: [],
    confirmedPatterns: seeds,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 检测项目中使用的分析 SDK
 *
 * @param projectPath 项目根目录
 * @param callGraph 调用图（来自 buildFunctionIndex）
 * @param functionIndex 函数索引（用于兜底检测时区分内外部方法）
 * @returns 检测到的 SDK 列表
 */
export async function detectSdks(
  projectPath: string,
  callGraph: Map<string, CallSite[]>,
  functionIndex: Map<string, FunctionDecl[]>
): Promise<DetectedSdk[]> {
  const absolutePath = path.resolve(projectPath);
  const detected: DetectedSdk[] = [];

  // Phase 1: package.json 扫描
  const pkgResults = scanPackageJson(absolutePath);

  // Phase 2: 代码 import 扫描
  const files = await fg(SOURCE_GLOB, {
    cwd: absolutePath,
    ignore: IGNORE_PATTERNS,
    absolute: true,
    onlyFiles: true,
  });
  const importResults = scanImports(absolutePath, files);

  // Phase 3: 对每个已知 SDK 确认其方法被使用
  for (const sdk of KNOWN_SDKS) {
    const pkgName = pkgResults.get(sdk.name);
    const importFiles = importResults.get(sdk.name) || [];
    const confirmedPatterns = confirmRawCalls(sdk, callGraph);

    // 至少满足一项：package.json 有 / import 有 / 调用有
    if (pkgName || importFiles.length > 0 || confirmedPatterns.length > 0) {
      detected.push({
        sdk,
        detectedPackage: pkgName,
        importFiles,
        confirmedPatterns,
      });
    }
  }

  // 兜底：从调用图中发现已知 SDK 未覆盖的高频跟踪方法
  // 已知 SDK 的 confirmedPatterns 收集到集合中，用于排除
  const coveredPatterns = new Set<string>();
  for (const sdk of detected) {
    for (const p of sdk.confirmedPatterns) {
      coveredPatterns.add(p);
    }
  }

  const unknown = detectTrackingMethodsFromCallGraph(callGraph, functionIndex);
  if (unknown) {
    // 过滤掉已被已知 SDK 覆盖的方法
    const newPatterns = unknown.confirmedPatterns.filter(
      (p) => !coveredPatterns.has(p)
    );
    if (newPatterns.length > 0) {
      detected.push({
        sdk: unknown.sdk,
        importFiles: [],
        confirmedPatterns: newPatterns,
      });
    }
  }

  return detected;
}
