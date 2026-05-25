import { parse, Lang } from "@ast-grep/napi";
import type {
  DetectedSdk,
  FunctionDecl,
  CallSite,
  WrapperNode,
  SdkChain,
} from "../types.js";
import { generateCallPatterns } from "./file-utils.js";

/** 最大追踪深度 */
const MAX_DEPTH = 10;

/**
 * 检查函数体中是否包含对指定方法的调用
 * 先用 includes 快速预筛，再用 ast-grep 精确验证
 */
function bodyCallsMethod(
  body: string,
  methodName: string,
  lang: Lang
): boolean {
  // 快速预筛
  const shortName = methodName.includes(".")
    ? methodName.split(".").pop()!
    : methodName;
  if (!body.includes(shortName)) return false;

  // ast-grep 精确验证
  const patterns = generateCallPatterns(methodName);

  try {
    const root = parse(lang, body).root();

    for (const pattern of patterns) {
      try {
        const matches = root.findAll(pattern);
        if (matches.length > 0) return true;
      } catch {
        continue;
      }
    }
  } catch {
    // 解析失败时退回到字符串匹配
    for (const pattern of patterns) {
      const simpleName = pattern.replace(/\$\$\$/g, "").replace(/\(/g, "");
      if (body.includes(simpleName)) return true;
    }
  }

  return false;
}

/**
 * 从函数声明列表中找出调用了指定方法的函数
 */
function findWrappers(
  methodName: string,
  allDecls: FunctionDecl[],
  visited: Set<string>
): FunctionDecl[] {
  const wrappers: FunctionDecl[] = [];

  for (const decl of allDecls) {
    // 用复合键去重，允许同名函数在不同文件中作为封装
    const key = `${decl.name}::${decl.filePath}`;
    if (visited.has(key)) continue;
    if (!decl.body || decl.body.trim().length === 0) continue;

    // 判断语言（.ts 文件用 TypeScript）
    const lang = decl.filePath.endsWith(".ts") ||
      decl.filePath.endsWith(".tsx")
      ? Lang.TypeScript
      : Lang.JavaScript;

    if (bodyCallsMethod(decl.body, methodName, lang)) {
      // 过滤：只保留函数名含埋点关键词，或位于埋点相关文件中的函数
      const isTrackingName = /track|event|analytics|sensor|bury|report|capture/i.test(
        decl.name
      );
      const isTrackingFile = /track|sensor|analytics|bury|event/i.test(
        decl.filePath
      );

      if (isTrackingName || isTrackingFile) {
        wrappers.push(decl);
      }
    }
  }

  return wrappers;
}

/**
 * 将函数声明转为 WrapperNode
 */
function declToNode(
  decl: FunctionDecl,
  level: number,
  callGraph: Map<string, CallSite[]>
): WrapperNode {
  const callSites = callGraph.get(decl.name) || [];
  const usageExample = callSites.length > 0
    ? callSites.sort((a, b) => a.callText.length - b.callText.length)[0]
        .callText.slice(0, 150)
    : undefined;

  return {
    name: decl.name,
    filePath: decl.filePath,
    level,
    callCount: callSites.length,
    signature: decl.signature,
    usageExample,
    importStatement: undefined, // 在编排器中补全
  };
}

/**
 * 自底向上追踪 SDK 的封装链
 *
 * @param sdk 检测到的 SDK
 * @param functionIndex 函数索引
 * @param callGraph 调用图
 * @returns 封装链（每层一个数组）
 */
export function traceChain(
  sdk: DetectedSdk,
  functionIndex: Map<string, FunctionDecl[]>,
  callGraph: Map<string, CallSite[]>
): SdkChain {
  const levels: WrapperNode[][] = [];
  // 用 name::filePath 复合键去重，允许同名函数在不同文件中作为封装层
  const visited = new Set<string>();

  // Level 0: SDK 原始方法
  const level0: WrapperNode[] = [];
  for (const calleeName of sdk.confirmedPatterns) {
    const callSites = callGraph.get(calleeName) || [];
    level0.push({
      name: calleeName,
      filePath: "(SDK)",
      level: 0,
      callCount: callSites.length,
      usageExample: callSites.length > 0
        ? callSites[0].callText.slice(0, 150)
        : undefined,
    });
    visited.add(`${calleeName}::(SDK)`);
  }
  levels.push(level0);

  // 收集所有函数声明（扁平化）
  const allDecls: FunctionDecl[] = [];
  for (const decls of functionIndex.values()) {
    allDecls.push(...decls);
  }

  // 迭代向上追踪
  let currentLevel = 0;
  while (currentLevel < MAX_DEPTH) {
    const currentMethods = levels[currentLevel];
    const nextLevel: WrapperNode[] = [];

    for (const method of currentMethods) {
      const wrappers = findWrappers(method.name, allDecls, visited);

      for (const wrapper of wrappers) {
        const key = `${wrapper.name}::${wrapper.filePath}`;
        if (visited.has(key)) continue;

        const node = declToNode(wrapper, currentLevel + 1, callGraph);
        nextLevel.push(node);
        visited.add(key);
      }
    }

    if (nextLevel.length === 0) break;

    levels.push(nextLevel);
    currentLevel++;
  }

  return { sdk, levels };
}
