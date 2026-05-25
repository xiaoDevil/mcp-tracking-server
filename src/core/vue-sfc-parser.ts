/** 从 .vue SFC 文件中提取 script 和 template 内容 */
export function parseVueSFC(content: string): {
  script: { code: string; offset: number } | null;
  template: { code: string; offset: number } | null;
} {
  let script: { code: string; offset: number } | null = null;
  let template: { code: string; offset: number } | null = null;

  const scriptMatch = content.match(
    /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i
  );
  if (scriptMatch) {
    const before = content.slice(0, scriptMatch.index);
    const offset = before.split("\n").length;
    script = { code: scriptMatch[1], offset };
  }

  const templateMatch = content.match(
    /<template(?:\s+[^>]*)?>([\s\S]*?)<\/template>/i
  );
  if (templateMatch) {
    const before = content.slice(0, templateMatch.index);
    const offset = before.split("\n").length;
    template = { code: templateMatch[1], offset };
  }

  return { script, template };
}
