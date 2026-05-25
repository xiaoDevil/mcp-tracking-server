import { z } from "zod";
import { parseTrackingEventsOnly } from "../utils/excel-parser.js";
import { successResponse, withErrorHandling } from "./tool-helpers.js";

export const parseTrackingDocTool = {
  name: "parse_tracking_doc",
  description: `解析神策(Sensors)格式埋点 Excel 文档，提取"自定义事件表"中的所有事件定义。返回每个事件的英文名、显示名、触发时机、所属平台和参数列表。用于获取需要埋点的事件清单。`,

  schema: {
    filePath: z
      .string()
      .describe("Excel 埋点文档的绝对路径（如 C:\\Users\\xx\\doc.xlsx）"),
  },

  handler: withErrorHandling(async (args) => {
    const result = parseTrackingEventsOnly(args.filePath);
    return successResponse(result);
  }, "解析 Excel 文件失败"),
};
