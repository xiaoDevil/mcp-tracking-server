import path from "node:path";
import fs from "node:fs";
import type {
  SearchResult,
  TrackingMethodInfo,
  SdkInfo,
  TrackingFileInfo,
  SdkChain,
  ChainRecommendation,
  WrapperNode,
} from "../types.js";
import { TRACKING_FILE_GLOBS } from "../constants.js";
import { getFileSnippet } from "./file-utils.js";
import { buildFunctionIndex } from "./function-index.js";
import { detectSdks } from "./sdk-detector.js";
import { traceChain } from "./chain-tracer.js";
import fg from "fast-glob";

/**
 * 根据方法名推断使用场景
 */
function inferScenario(name: string): string {
  const lower = name.toLowerCase();
  if (/pageview|page_view|pv/.test(lower)) return "页面浏览";
  if (/exposure|show|appear|visible/.test(lower)) return "曝光";
  if (/click|tap|press|submit/.test(lower)) return "点击/交互";
  if (/share/.test(lower)) return "分享";
  if (/pay|order|purchase|buy/.test(lower)) return "交易/支付";
  if (/login|register|signup|identify/.test(lower)) return "用户身份";
  return "自定义事件";
}

/** 判断方法来源是项目级（composables/plugins/utils）还是页面级 */
function inferScope(filePath: string): "project" | "page" {
  if (filePath === "(SDK)") return "project";
  if (/composables|plugins|utils|directives|middleware|lib|helpers/i.test(filePath)) {
    return "project";
  }
  return "page";
}

/**
 * 从封装链中构建所有核心方法的推荐结果
 */
function buildAllRecommendations(chain: SdkChain): ChainRecommendation[] {
  const { sdk, levels } = chain;
  const sdkName = sdk.sdk.name;
  const recommendations: ChainRecommendation[] = [];

  // 从最高层到 Level 0 收集有调用的方法，同名只保留最高层级
  const seen = new Set<string>();
  const allMethods: { node: WrapperNode; level: number }[] = [];
  for (let i = levels.length - 1; i >= 0; i--) {
    for (const node of levels[i]) {
      if (node.callCount > 0 && !seen.has(node.name)) {
        seen.add(node.name);
        allMethods.push({ node, level: i });
      }
    }
  }

  for (const { node, level } of allMethods) {
    const scope = inferScope(node.filePath);
    recommendations.push({
      sdkName,
      method: node.name,
      level,
      reason: `${inferScenario(node.name)}，${scope === "project" ? "项目级 API" : "页面级 helper"}，共 ${node.callCount} 处调用`,
      usageExample: node.usageExample || `${node.name}(eventName, properties)`,
      importStatement: node.importStatement,
      signature: node.signature,
    });
  }

  // 项目级优先，再按调用次数降序
  recommendations.sort((a, b) => {
    const projectA = a.reason.includes("项目级") ? 0 : 1;
    const projectB = b.reason.includes("项目级") ? 0 : 1;
    if (projectA !== projectB) return projectA - projectB;
    const countA = parseInt(a.reason.match(/共 (\d+) 处/)?.[1] || "0");
    const countB = parseInt(b.reason.match(/共 (\d+) 处/)?.[1] || "0");
    return countB - countA;
  });

  return recommendations;
}

/**
 * 将封装链转为扁平的 TrackingMethodInfo 列表（向后兼容）
 */
function buildFlatMethods(chains: SdkChain[]): TrackingMethodInfo[] {
  const methods: TrackingMethodInfo[] = [];

  for (const chain of chains) {
    for (let i = chain.levels.length - 1; i >= 0; i--) {
      for (const node of chain.levels[i]) {
        if (node.filePath === "(SDK)" && i === 0) {
          methods.push({
            name: node.name,
            filePath: node.filePath,
            signature: node.signature,
            usageExample: node.usageExample,
            type: "raw-sdk",
            isWrapped: false,
            callCount: node.callCount,
          });
        } else {
          methods.push({
            name: node.name,
            filePath: node.filePath,
            signature: node.signature,
            usageExample: node.usageExample,
            importStatement: node.importStatement,
            type: `level-${i}-wrapper`,
            isWrapped: i > 0,
            callCount: node.callCount,
          });
        }
      }
    }
  }

  methods.sort((a, b) => {
    if (a.isWrapped !== b.isWrapped) return a.isWrapped ? -1 : 1;
    return (b.callCount || 0) - (a.callCount || 0);
  });

  return methods;
}

/**
 * 搜索埋点基础设施文件
 */
async function findTrackingFiles(
  absolutePath: string
): Promise<TrackingFileInfo[]> {
  const trackingFiles: TrackingFileInfo[] = [];

  for (const { glob, type } of TRACKING_FILE_GLOBS) {
    const files = await fg(glob, {
      cwd: absolutePath,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    });

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        trackingFiles.push({
          path: path.relative(absolutePath, file).replace(/\\/g, "/"),
          type,
          snippet: getFileSnippet(content),
        });
      } catch {
        trackingFiles.push({
          path: path.relative(absolutePath, file).replace(/\\/g, "/"),
          type,
        });
      }
    }
  }

  const seen = new Set<string>();
  return trackingFiles.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

/**
 * 为推荐方法补全 import 语句
 */
function enrichRecommendationImport(
  rec: ChainRecommendation,
  trackingFiles: TrackingFileInfo[]
): void {
  if (rec.importStatement) return;

  const cleanName = rec.method.replace(/^\$/, "");
  for (const file of trackingFiles) {
    if (!file.snippet) continue;

    const importMatch = file.snippet.match(
      new RegExp(
        `import\\s*\\{[^}]*\\b${cleanName}\\b[^}]*\\}\\s*from\\s*['"\`]([^'"\`]+)['"\`]`
      )
    );
    if (importMatch) {
      rec.importStatement = importMatch[0];
      return;
    }
  }
}

/**
 * 主搜索入口：检测 SDK → 追踪封装链 → 推荐
 */
export async function searchTrackingMethods(
  projectPath: string
): Promise<SearchResult> {
  const absolutePath = path.resolve(projectPath);

  // Step 1: 构建函数索引和调用图
  const { functionIndex, callGraph } =
    await buildFunctionIndex(absolutePath);

  // Step 2: 检测 SDK
  const detectedSdks = await detectSdks(absolutePath, callGraph, functionIndex);

  // Step 3: 对每个 SDK 追踪封装链
  const chains: SdkChain[] = [];
  for (const sdk of detectedSdks) {
    const chain = traceChain(sdk, functionIndex, callGraph);
    chains.push(chain);
  }

  // Step 4: 构建推荐（每个 chain 可能返回多个推荐方法）
  const recommendations: ChainRecommendation[] = [];
  for (const chain of chains) {
    recommendations.push(...buildAllRecommendations(chain));
  }

  // 跨链统一排序：项目级优先，再按调用次数降序
  recommendations.sort((a, b) => {
    const projectA = a.reason.includes("项目级") ? 0 : 1;
    const projectB = b.reason.includes("项目级") ? 0 : 1;
    if (projectA !== projectB) return projectA - projectB;
    const countA = parseInt(a.reason.match(/共 (\d+) 处/)?.[1] || "0");
    const countB = parseInt(b.reason.match(/共 (\d+) 处/)?.[1] || "0");
    return countB - countA;
  });

  // Step 5: 搜索埋点基础设施文件
  const trackingFiles = await findTrackingFiles(absolutePath);

  // Step 6: 补全推荐的 import 语句
  for (const rec of recommendations) {
    enrichRecommendationImport(rec, trackingFiles);
  }

  // Step 7: 向后兼容的扁平输出
  const methods = buildFlatMethods(chains);
  const sdks: SdkInfo[] = detectedSdks.map((s) => ({
    name: s.sdk.name,
    detectedFiles: s.importFiles,
  }));
  const recommendation =
    recommendations.length > 0
      ? {
          method: recommendations[0].method,
          type: `level-${recommendations[0].level}-wrapper`,
          reason: recommendations[0].reason,
          usageExample: recommendations[0].usageExample,
          importStatement: recommendations[0].importStatement,
        }
      : undefined;

  return {
    chains,
    recommendations,
    trackingFiles,
    methods,
    sdks,
    recommendation,
  };
}
