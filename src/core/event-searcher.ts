import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { parse, Lang } from "@ast-grep/napi";
import { IGNORE_PATTERNS, SOURCE_GLOB } from "../constants.js";
import { parseVueSFC } from "./vue-sfc-parser.js";
import { getLang } from "./file-utils.js";

export async function batchSearchEventsInCode(
  projectPath: string,
  eventNames: string[]
): Promise<Map<string, string[]>> {
  const absolutePath = path.resolve(projectPath);
  const result = new Map<string, string[]>();
  for (const name of eventNames) {
    result.set(name, []);
  }

  const files = await fg(SOURCE_GLOB, {
    cwd: absolutePath,
    ignore: IGNORE_PATTERNS,
    absolute: true,
    onlyFiles: true,
  });

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relativePath = path.relative(absolutePath, file);
    const ext = path.extname(file);

    let scriptContent: string | null = null;
    let lang: Lang | null = null;

    if (ext === ".vue") {
      const parts = parseVueSFC(content);
      if (parts.script) {
        scriptContent = parts.script.code;
        lang = Lang.TypeScript;
      }
    } else {
      scriptContent = content;
      lang = getLang(ext);
    }

    if (!scriptContent || !lang) continue;

    try {
      const ast = parse(lang, scriptContent);
      const root = ast.root();

      for (const eventName of eventNames) {
        if (
          !scriptContent.includes(`'${eventName}'`) &&
          !scriptContent.includes(`"${eventName}"`) &&
          !scriptContent.includes(`\`${eventName}\``)
        ) {
          continue;
        }

        const patterns = [
          `$FN('${eventName}')`, `$FN("${eventName}")`, `$FN(\`${eventName}\`)`,
          `$FN('${eventName}', $$$ARGS)`, `$FN("${eventName}", $$$ARGS)`, `$FN(\`${eventName}\`, $$$ARGS)`,
        ];

        const allMatches = patterns.flatMap(p => root.findAll(p));

        if (allMatches.length > 0) {
          const files = result.get(eventName) || [];
          if (!files.includes(relativePath)) {
            files.push(relativePath);
          }
        }
      }
    } catch {
      for (const eventName of eventNames) {
        const regex = new RegExp(
          `['"\`]\\s*${eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*['"\`]`,
          "g"
        );
        if (regex.test(content)) {
          const files = result.get(eventName) || [];
          if (!files.includes(relativePath)) {
            files.push(relativePath);
          }
        }
        regex.lastIndex = 0;
      }
    }
  }

  return result;
}

export async function searchEventInCode(
  projectPath: string,
  eventName: string
): Promise<string[]> {
  const batch = await batchSearchEventsInCode(projectPath, [eventName]);
  return batch.get(eventName) || [];
}
