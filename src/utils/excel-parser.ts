import XLSX from "xlsx";
import path from "node:path";
import type {
  TrackingEvent,
  ParseResult,
  SheetData,
  ComprehensiveParseResult,
} from "../types.js";

/**
 * 在 sheet 列表中模糊匹配"自定义事件表"
 */
function findCustomEventSheet(sheetNames: string[]): string | null {
  const exactMatch = sheetNames.find((name) => name === "自定义事件表");
  if (exactMatch) return exactMatch;

  const fuzzyMatch = sheetNames.find((name) => {
    const lower = name.toLowerCase();
    return (
      (lower.includes("自定义") || lower.includes("custom")) &&
      (lower.includes("事件") || lower.includes("event"))
    );
  });

  return fuzzyMatch || null;
}

/**
 * 埋点 sheet 的关键列名特征
 */
const TRACKING_COLUMN_KEYWORDS = [
  "事件英文变量名",
  "事件英文名",
  "属性英文变量名",
  "属性英文名",
  "触发时机",
  "应埋点平台",
];

/**
 * 需要排除的 sheet 关键词（这些不是手动埋点事件表）
 */
const EXCLUDE_SHEET_KEYWORDS = ["全埋点", "预置", "preset", "auto"];

/**
 * 智能识别哪个 sheet 是埋点事件表
 *
 * 策略：
 * 1. 精确/模糊匹配 "自定义事件表"
 * 2. 若未找到，扫描每个 sheet 的列头，匹配埋点相关关键词的数量打分
 * 3. 排除全埋点、预置属性等非手动埋点 sheet
 * 4. 选得分最高的 sheet
 */
function identifyTrackingSheet(
  sheetNames: string[],
  workbook: XLSX.WorkBook
): string | null {
  // 优先匹配 "自定义事件表"
  const customSheet = findCustomEventSheet(sheetNames);
  if (customSheet) return customSheet;

  // 打分：检查列头含有关键词的数量
  let bestSheet: string | null = null;
  let bestScore = 0;

  for (const name of sheetNames) {
    // 排除全埋点、预置属性等非手动埋点 sheet
    const lowerName = name.toLowerCase();
    if (EXCLUDE_SHEET_KEYWORDS.some((kw) => lowerName.includes(kw))) continue;

    const sheet = workbook.Sheets[name];
    const rows: (string | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: undefined,
    });

    // 检查前 5 行中的所有单元格，收集关键词匹配
    let score = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      for (const cell of rows[i]) {
        if (!cell) continue;
        const text = cell.toString();
        for (const keyword of TRACKING_COLUMN_KEYWORDS) {
          if (text.includes(keyword)) score++;
        }
      }
    }

    // sheet 名称也参与打分
    if (lowerName.includes("事件") || lowerName.includes("event")) score += 2;
    if (lowerName.includes("埋点") || lowerName.includes("track")) score += 2;
    if (lowerName.includes("自定义") || lowerName.includes("custom"))
      score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestSheet = name;
    }
  }

  return bestScore >= 3 ? bestSheet : null;
}

/**
 * 解析单个 sheet 为通用 SheetData
 */
function parseSheetToData(
  workbook: XLSX.WorkBook,
  sheetName: string
): SheetData {
  const sheet = workbook.Sheets[sheetName];
  const rows: (string | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: undefined,
  });

  if (rows.length === 0) {
    return { sheetName, description: "", headers: [], data: [] };
  }

  // 第一行通常为说明
  const description = rows[0]?.filter(Boolean).join(" ") || "";

  // 找到列头行（包含"必填"或关键列名，且非空单元格 >= 3 的行）
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const rowText = row.join("");
    const nonEmptyCount = row.filter((c) => c !== undefined && c !== null).length;
    if (
      nonEmptyCount >= 3 &&
      (rowText.includes("必填") ||
        rowText.includes("英文变量名") ||
        rowText.includes("英文名"))
    ) {
      headerRowIndex = i;
      break;
    }
  }

  // 若没找到典型列头行，用第一非空行作为列头
  if (headerRowIndex === -1) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.some((c) => c !== undefined && c !== null)) {
        headerRowIndex = i;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    return { sheetName, description, headers: [], data: [] };
  }

  const headers = (rows[headerRowIndex] || []).map((h) =>
    h ? h.toString().trim() : ""
  );

  const data: Record<string, string | null>[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === undefined || c === null)) continue;

    const record: Record<string, string | null> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const cell = row[idx];
      record[header] = cell !== undefined && cell !== null
        ? cell.toString().trim() || null
        : null;
    });
    data.push(record);
  }

  return { sheetName, description, headers, data };
}

/**
 * 列头关键词到语义字段的映射
 */
const COLUMN_PATTERNS = {
  eventId: ["事件编号"],
  eventName: ["事件英文变量名", "事件英文名"],
  eventDisplayName: ["事件显示名"],
  propertyName: ["属性英文变量名", "属性英文名"],
  propertyDisplayName: ["属性显示名"],
  propertyType: ["数据类型"],
  propertyExample: ["属性值示例", "属性值说明"],
  platform: ["应埋点平台", "所属平台", "设置平台"],
  triggerTiming: ["触发时机"],
  remark: ["备注"],
} as const;

type ColumnKey = keyof typeof COLUMN_PATTERNS;

/**
 * 根据列头文本匹配语义字段名
 */
function matchColumnKey(headerText: string): ColumnKey | null {
  const text = headerText.replace(/（必填）/g, "").trim();
  for (const [key, patterns] of Object.entries(COLUMN_PATTERNS) as unknown as [ColumnKey, string[]][]) {
    if (patterns.some((p) => text.includes(p))) return key;
  }
  return null;
}

/**
 * 从 sheet 的前几行中找到列头行，建立语义字段到列索引的映射
 */
function buildColumnMap(rows: (string | undefined)[][]): {
  colMap: Partial<Record<ColumnKey, number>>;
  headerRowIndex: number;
} {
  const colMap: Partial<Record<ColumnKey, number>> = {};
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const nonEmptyCount = row.filter((c) => c !== undefined && c !== null).length;
    if (nonEmptyCount < 3) continue;

    const matched = new Set<ColumnKey>();
    for (let j = 0; j < row.length; j++) {
      const cell = row[j]?.toString().trim();
      if (!cell) continue;
      const key = matchColumnKey(cell);
      if (key && !matched.has(key)) {
        colMap[key] = j;
        matched.add(key);
      }
    }

    // 至少匹配到事件名 + 属性名这两个核心列才算列头行
    if (matched.has("eventName") && matched.has("propertyName")) {
      headerRowIndex = i;
      break;
    }
    // 匹配到 3 个以上也算（适配只有事件的简单表）
    if (matched.size >= 3) {
      headerRowIndex = i;
      break;
    }
  }

  return { colMap, headerRowIndex };
}

/**
 * 按语义字段从行中取值
 */
function getCellValue(
  row: (string | undefined)[],
  colMap: Partial<Record<ColumnKey, number>>,
  key: ColumnKey
): string | undefined {
  const idx = colMap[key];
  if (idx === undefined) return undefined;
  return row[idx]?.toString().trim() || undefined;
}

/**
 * 从指定的 sheet 解析埋点事件列表（合并行模式）
 */
function parseEventsFromSheet(
  workbook: XLSX.WorkBook,
  sheetName: string
): TrackingEvent[] {
  const sheet = workbook.Sheets[sheetName];
  const rows: (string | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: undefined,
  });

  // 动态建立列映射
  const { colMap, headerRowIndex } = buildColumnMap(rows);
  if (headerRowIndex === -1) {
    throw new Error(`Sheet "${sheetName}" 中未找到有效的列头行`);
  }

  const events: TrackingEvent[] = [];
  let currentEvent: TrackingEvent | null = null;
  let currentEventId = 0;

  // 从列头行的下一行开始
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const eventIdVal = getCellValue(row, colMap, "eventId");
    const eventName = getCellValue(row, colMap, "eventName");
    const eventDisplayName = getCellValue(row, colMap, "eventDisplayName");
    const propName = getCellValue(row, colMap, "propertyName");
    const propDisplayName = getCellValue(row, colMap, "propertyDisplayName");
    const propType = getCellValue(row, colMap, "propertyType");
    const propExample = getCellValue(row, colMap, "propertyExample");
    const platform = getCellValue(row, colMap, "platform");
    const triggerTiming = getCellValue(row, colMap, "triggerTiming");
    const remark = getCellValue(row, colMap, "remark");

    // 跳过列名行（eventName 列包含列头关键词）
    if (eventName && (eventName.includes("英文名") || eventName.includes("必填"))) {
      continue;
    }

    // 有事件编号或事件英文名 = 新事件行
    if ((eventIdVal || eventName) && !propName) {
      currentEventId++;
      currentEvent = {
        eventId: currentEventId,
        eventName: eventName || "",
        eventDisplayName: eventDisplayName || "",
        platform: platform || "",
        triggerTiming: triggerTiming || "",
        properties: [],
        remark: remark || undefined,
      };
      events.push(currentEvent);
      continue;
    }

    // 有属性英文名 = 参数行，追加到当前事件
    if (propName && currentEvent) {
      currentEvent.properties.push({
        name: propName,
        displayName: propDisplayName || "",
        type: propType || "STRING",
        example: propExample || undefined,
      });
    }
  }

  return events;
}

/**
 * 解析神策格式埋点 Excel 的"自定义事件表"（向后兼容）
 */
export function parseCustomEventSheet(filePath: string): ParseResult {
  const absolutePath = path.resolve(filePath);
  const workbook = XLSX.readFile(absolutePath);

  const sheetName = findCustomEventSheet(workbook.SheetNames);
  if (!sheetName) {
    throw new Error(
      `未找到"自定义事件表"Sheet。可用 Sheet: ${workbook.SheetNames.join(", ")}`
    );
  }

  const events = parseEventsFromSheet(workbook, sheetName);

  return {
    events,
    totalEvents: events.length,
    sheetName,
  };
}

/**
 * 全量解析神策格式埋点 Excel
 *
 * - 解析所有 sheet 为通用 JSON
 * - 智能识别埋点事件 sheet 并详细解析为 TrackingEvent[]
 * - 若存在"自定义事件表"则优先使用，否则通过列结构特征自动识别
 */
export function parseAllSheets(filePath: string): ComprehensiveParseResult {
  const absolutePath = path.resolve(filePath);
  const workbook = XLSX.readFile(absolutePath);

  // 1. 解析所有 sheet
  const sheets = workbook.SheetNames.map((name) =>
    parseSheetToData(workbook, name)
  );

  // 2. 智能识别埋点事件 sheet
  const trackingSheetName = identifyTrackingSheet(
    workbook.SheetNames,
    workbook
  );

  if (!trackingSheetName) {
    throw new Error(
      `未能识别出埋点事件 Sheet。可用 Sheet: ${workbook.SheetNames.join(", ")}`
    );
  }

  // 3. 从埋点 sheet 详细解析事件列表
  const events = parseEventsFromSheet(workbook, trackingSheetName);

  return {
    sheetNames: workbook.SheetNames,
    sheets,
    trackingSheetName,
    events,
    totalEvents: events.length,
  };
}

/**
 * 精简解析：只返回埋点事件表的 JSON，不解析其他 sheet
 *
 * 用于工具返回，避免全量数据超出 token 限制
 */
export interface TrackingEventsResult {
  sheetName: string;
  allSheetNames: string[];
  totalEvents: number;
  events: {
    eventName: string;
    eventDisplayName: string;
    triggerTiming: string;
    platform: string;
    properties: {
      name: string;
      displayName: string;
      type: string;
      example?: string;
    }[];
    remark?: string;
  }[];
}

export function parseTrackingEventsOnly(
  filePath: string
): TrackingEventsResult {
  const absolutePath = path.resolve(filePath);
  const workbook = XLSX.readFile(absolutePath);

  const trackingSheetName = identifyTrackingSheet(
    workbook.SheetNames,
    workbook
  );

  if (!trackingSheetName) {
    throw new Error(
      `未能识别出埋点事件 Sheet。可用 Sheet: ${workbook.SheetNames.join(", ")}`
    );
  }

  const events = parseEventsFromSheet(workbook, trackingSheetName);

  return {
    sheetName: trackingSheetName,
    allSheetNames: workbook.SheetNames,
    totalEvents: events.length,
    events: events.map((e) => ({
      eventName: e.eventName,
      eventDisplayName: e.eventDisplayName,
      triggerTiming: e.triggerTiming,
      platform: e.platform,
      properties: e.properties.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        type: p.type,
        ...(p.example ? { example: p.example } : {}),
      })),
      ...(e.remark ? { remark: e.remark } : {}),
    })),
  };
}
