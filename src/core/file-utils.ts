import { Lang } from "@ast-grep/napi";

/** 根据文件扩展名获取 ast-grep 语言 */
export function getLang(ext: string): Lang | null {
  switch (ext) {
    case ".ts":
    case ".tsx":
      return Lang.TypeScript;
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return Lang.JavaScript;
    default:
      return null;
  }
}

export function extractSignature(
  content: string,
  methodName: string
): string | undefined {
  const cleanName = methodName.replace(/^\$/, "").replace(/\..*$/, "");
  const patterns = [
    new RegExp(
      `(?:export\\s+)?(?:async\\s+)?function\\s+${cleanName}\\s*\\([^)]*\\)`,
      "g"
    ),
    new RegExp(
      `(?:export\\s+)?(?:const|let|var)\\s+\\$?${cleanName}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[\\w]+)\\s*=>`,
      "g"
    ),
    new RegExp(
      `(?:export\\s+)?(?:const|let|var)\\s+\\$?${cleanName}\\s*=\\s*(?:async\\s+)?function\\s*\\([^)]*\\)`,
      "g"
    ),
  ];

  for (const regex of patterns) {
    const match = regex.exec(content);
    if (match) {
      const startIdx = match.index;
      const lineStart = content.lastIndexOf("\n", startIdx) + 1;
      const lineEnd = content.indexOf("\n", startIdx);
      const line = content
        .slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
        .trim();
      regex.lastIndex = 0;
      return line.length > 200 ? line.slice(0, 200) + "..." : line;
    }
    regex.lastIndex = 0;
  }
  return undefined;
}

export function extractImportStatement(
  content: string,
  methodName: string
): string | undefined {
  const cleanName = methodName.replace(/^\$/, "");
  const patterns = [
    new RegExp(
      `import\\s*\\{[^}]*\\b${cleanName}\\b[^}]*\\}\\s*from\\s*['"\`]([^'"\`]+)['"\`]`
    ),
    new RegExp(
      `import\\s+${cleanName}\\s+from\\s*['"\`]([^'"\`]+)['"\`]`
    ),
    new RegExp(
      `(?:const|let|var)\\s*\\{[^}]*\\b${cleanName}\\b[^}]*\\}\\s*=\\s*require\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)`
    ),
  ];

  for (const regex of patterns) {
    const match = regex.exec(content);
    if (match) return match[0];
  }
  return undefined;
}

export function getFileSnippet(content: string, maxLines: number = 30): string {
  const lines = content.split("\n").slice(0, maxLines);
  return lines.join("\n");
}

/** 从调用模式中提取调用者名称 */
export function extractCalleeName(pattern: string): string {
  return pattern.replace(/\(.*$/, "").trim();
}

/** 为给定方法名生成 ast-grep 调用检测模式 */
export function generateCallPatterns(methodName: string): string[] {
  const patterns: string[] = [];

  // 如果已包含 . 则是成员调用，直接匹配
  if (methodName.includes(".")) {
    patterns.push(`${methodName}($$$ARGS)`);
    return patterns;
  }

  // 普通函数名：覆盖直接调用、this. 前缀、对象前缀
  patterns.push(`${methodName}($$$ARGS)`);
  patterns.push(`this.${methodName}($$$ARGS)`);
  patterns.push(`$OBJ.${methodName}($$$ARGS)`);
  return patterns;
}
