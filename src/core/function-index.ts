import path from "node:path";
import fs from "node:fs";
import { parse, Lang } from "@ast-grep/napi";
import type { FunctionDecl, CallSite } from "../types.js";
import { getLang } from "./file-utils.js";
import { parseVueSFC } from "./vue-sfc-parser.js";
import { IGNORE_PATTERNS, SOURCE_GLOB } from "../constants.js";
import fg from "fast-glob";

/** 函数声明提取的 ast-grep 模式 */
const FUNC_PATTERNS = [
  "function $NAME($$$PARAMS) { $$$BODY }",
  "async function $NAME($$$PARAMS) { $$$BODY }",
  "const $NAME = ($$$PARAMS) => { $$$BODY }",
  "const $NAME = ($$$PARAMS) => $BODY",
  "const $NAME = function($$$PARAMS) { $$$BODY }",
  "const $NAME = async ($$$PARAMS) => { $$$BODY }",
  "const $NAME = async function($$$PARAMS) { $$$BODY }",
];

/** 函数体最大解析长度，超出截断 */
const MAX_BODY_LENGTH = 5000;

export interface FunctionIndexResult {
  functionIndex: Map<string, FunctionDecl[]>;
  callGraph: Map<string, CallSite[]>;
}

/**
 * 从源码内容中提取函数声明
 */
function extractFunctions(
  content: string,
  filePath: string,
  lang: Lang
): FunctionDecl[] {
  const declarations: FunctionDecl[] = [];

  try {
    const root = parse(lang, content).root();

    for (const pattern of FUNC_PATTERNS) {
      try {
        const matches = root.findAll(pattern);
        for (const match of matches) {
          const nameNode = match.getMatch("NAME");
          if (!nameNode) continue;

          const name = nameNode.text();
          if (!name || name.startsWith("_") || name.length < 2) continue;

          const fullText = match.text();
          const signature = fullText.split("\n")[0]?.slice(0, 200) || "";

          // 提取函数体：优先用 ast-grep 捕获，回退到从全文提取 {} 块
          let body = "";
          const bodyNode = match.getMatch("BODY");
          if (bodyNode && bodyNode.text().length > 0) {
            body = bodyNode.text().slice(0, MAX_BODY_LENGTH);
          } else {
            // 回退：找到第一个 { 和最后一个 } 之间的内容
            const firstBrace = fullText.indexOf("{");
            const lastBrace = fullText.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              body = fullText.slice(firstBrace + 1, lastBrace).trim().slice(0, MAX_BODY_LENGTH);
            }
          }

          let declType: FunctionDecl["declType"] = "function";
          if (fullText.includes("=>")) declType = "arrow";
          else if (fullText.match(/^\s*(?:const|let|var)/))
            declType = "variable";

          const isExported =
            fullText.includes("export ") ||
            content.includes(`export { ${name}`);

          declarations.push({
            name,
            filePath,
            signature,
            body,
            exportName: isExported ? name : undefined,
            declType,
          });
        }
      } catch {
        // 某些模式可能不匹配，忽略
      }
    }
  } catch {
    // 解析失败，跳过该文件
  }

  return declarations;
}

/**
 * 从内容中提取所有调用点
 */
function extractCallSites(
  content: string,
  filePath: string,
  lang: Lang
): CallSite[] {
  const callSites: CallSite[] = [];

  try {
    const root = parse(lang, content).root();

    const callPatterns = [
      "$FN($$$ARGS)",
      "$OBJ.$METHOD($$$ARGS)",
    ];

    for (const pattern of callPatterns) {
      try {
        const matches = root.findAll(pattern);
        for (const match of matches) {
          const fnNode = match.getMatch("FN");
          const objNode = match.getMatch("OBJ");
          const methodNode = match.getMatch("METHOD");

          let calleeName: string;
          if (fnNode) {
            calleeName = fnNode.text();
          } else if (objNode && methodNode) {
            calleeName = `${objNode.text()}.${methodNode.text()}`;
          } else {
            continue;
          }

          // 归一化：nuxtApp.$trackEvent → $trackEvent, this.$track → $track
          // 保留含 SDK 标识的（如 sa.track, sensors.track）
          const parts = calleeName.split(".");
          const method = parts[parts.length - 1];
          if (
            parts.length === 2 &&
            !/^(sa|sensors|gio|zhuge|mixpanel|gtag|ga|umeng|uma)$/.test(parts[0])
          ) {
            // 非已知 SDK 对象，取方法名（去掉 obj. 前缀）
            calleeName = method;
          }

          // 只保留合法标识符（含 . 和 $）的调用，过滤 IIFE 和复杂表达式
          if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(calleeName)) continue;

          // 过滤掉关键词和太短的名称
          if (
            !calleeName ||
            calleeName.length < 2 ||
            /^(if|for|while|switch|catch|return|new|typeof|void|delete|throw|class|import|export|from|require|console|window|document|Math|JSON|Object|Array|String|Number|Boolean|Promise|Error)$/.test(
              calleeName.split(".")[0]
            )
          ) {
            continue;
          }

          const callText = match.text().slice(0, 200);
          const range = match.range();
          const line =
            content.slice(0, range.start.index).split("\n").length;

          callSites.push({ calleeName, filePath, callText, line });
        }
      } catch {
        // 模式不匹配，忽略
      }
    }
  } catch {
    // 解析失败，跳过
  }

  return callSites;
}

/**
 * 去重辅助：按 name + filePath 去重
 */
function deduplicateDecls(decls: FunctionDecl[]): FunctionDecl[] {
  const seen = new Set<string>();
  return decls.filter((d) => {
    const key = `${d.name}::${d.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 处理单个文件的索引构建
 */
function indexFile(
  content: string,
  relativePath: string,
  lang: Lang,
  functionIndex: Map<string, FunctionDecl[]>,
  callGraph: Map<string, CallSite[]>
): void {
  const decls = extractFunctions(content, relativePath, lang);
  const calls = extractCallSites(content, relativePath, lang);

  for (const decl of deduplicateDecls(decls)) {
    const existing = functionIndex.get(decl.name) || [];
    existing.push(decl);
    functionIndex.set(decl.name, existing);
  }

  for (const call of calls) {
    const existing = callGraph.get(call.calleeName) || [];
    existing.push(call);
    callGraph.set(call.calleeName, existing);
  }
}

/**
 * 构建项目的函数索引和调用图
 */
export async function buildFunctionIndex(
  projectPath: string
): Promise<FunctionIndexResult> {
  const absolutePath = path.resolve(projectPath);

  const files = await fg(SOURCE_GLOB, {
    cwd: absolutePath,
    ignore: IGNORE_PATTERNS,
    absolute: true,
    onlyFiles: true,
  });

  const functionIndex = new Map<string, FunctionDecl[]>();
  const callGraph = new Map<string, CallSite[]>();

  for (const file of files) {
    const ext = path.extname(file);

    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (content.length === 0) continue;

    const relativePath = path.relative(absolutePath, file).replace(/\\/g, "/");

    if (ext === ".vue") {
      const { script } = parseVueSFC(content);
      if (!script || !script.code.trim()) continue;
      indexFile(script.code, relativePath, Lang.TypeScript, functionIndex, callGraph);
    } else {
      const lang = getLang(ext);
      if (!lang) continue;
      indexFile(content, relativePath, lang, functionIndex, callGraph);
    }
  }

  return { functionIndex, callGraph };
}
