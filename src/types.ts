// ==================== SDK 检测与封装链类型 ====================

/** 已知分析 SDK 的元数据 */
export interface KnownSdk {
  name: string;
  packages: string[];
  importPatterns: string[];
  rawCallPatterns: string[];
  trackMethodName: string;
}

/** 项目中检测到的 SDK */
export interface DetectedSdk {
  sdk: KnownSdk;
  detectedPackage?: string;
  importFiles: string[];
  confirmedPatterns: string[];
}

/** 从源码中提取的函数声明 */
export interface FunctionDecl {
  name: string;
  filePath: string;
  signature: string;
  body: string;
  exportName?: string;
  declType: "function" | "arrow" | "method" | "variable";
}

/** 代码中的调用点 */
export interface CallSite {
  calleeName: string;
  filePath: string;
  callText: string;
  line: number;
}

/** 封装链中的一个节点 */
export interface WrapperNode {
  name: string;
  filePath: string;
  level: number;
  callCount: number;
  signature?: string;
  usageExample?: string;
  importStatement?: string;
}

/** 单个 SDK 的完整封装链 */
export interface SdkChain {
  sdk: DetectedSdk;
  levels: WrapperNode[][];
}

/** 单个 SDK 的推荐结果 */
export interface ChainRecommendation {
  sdkName: string;
  method: string;
  level: number;
  reason: string;
  usageExample: string;
  importStatement?: string;
  signature?: string;
}

// ==================== 搜索结果类型 ====================

export interface TrackingMethodInfo {
  name: string;
  filePath: string;
  signature?: string;
  usageExample?: string;
  importStatement?: string;
  type?: string;
  isWrapped?: boolean;
  callCount?: number;
}

export interface SdkInfo {
  name: string;
  detectedFiles: string[];
}

export interface TrackingFileInfo {
  path: string;
  type: string;
  snippet?: string;
}

export interface SearchResult {
  /** 封装链（新） */
  chains: SdkChain[];
  /** 每个 SDK 的推荐（新） */
  recommendations: ChainRecommendation[];
  /** 埋点基础设施文件 */
  trackingFiles: TrackingFileInfo[];
  /** 扁平方法列表（向后兼容） */
  methods: TrackingMethodInfo[];
  /** 检测到的 SDK（向后兼容） */
  sdks: SdkInfo[];
  /** 首选推荐（向后兼容） */
  recommendation?: {
    method: string;
    type: string;
    reason: string;
    usageExample: string;
    importStatement?: string;
  };
}

// ==================== Excel 解析类型 ====================

export interface TrackingProperty {
  name: string;
  displayName: string;
  type: string;
  example?: string;
}

export interface TrackingEvent {
  eventId: number;
  eventName: string;
  eventDisplayName: string;
  platform: string;
  triggerTiming: string;
  properties: TrackingProperty[];
  remark?: string;
}

export interface ParseResult {
  events: TrackingEvent[];
  totalEvents: number;
  sheetName: string;
}

export interface SheetData {
  sheetName: string;
  description: string;
  headers: string[];
  data: Record<string, string | null>[];
}

export interface ComprehensiveParseResult {
  sheetNames: string[];
  sheets: SheetData[];
  trackingSheetName: string;
  events: TrackingEvent[];
  totalEvents: number;
}
