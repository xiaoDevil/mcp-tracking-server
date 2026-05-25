import { z } from "zod";
import { batchSearchEventsInCode } from "../core/event-searcher.js";
import { successResponse, withErrorHandling } from "./tool-helpers.js";

function computeCoverage(
  eventNames: string[],
  batchResult: Map<string, string[]>
) {
  const implemented: { eventName: string; files: string[] }[] = [];
  const missing: { eventName: string }[] = [];

  for (const eventName of eventNames) {
    const files = batchResult.get(eventName) || [];
    if (files.length > 0) {
      implemented.push({ eventName, files });
    } else {
      missing.push({ eventName });
    }
  }

  const coverage =
    eventNames.length > 0
      ? Math.round((implemented.length / eventNames.length) * 100)
      : 0;

  return {
    total: eventNames.length,
    implemented,
    missing,
    coverage: `${coverage}%`,
  };
}

export const checkTrackingCoverageTool = {
  name: "check_tracking_coverage",
  description:
    "检查项目代码中的埋点覆盖率。对比文档中定义的事件列表与代码中已有的埋点调用，返回已实现、缺失的事件和覆盖率百分比。",

  schema: {
    projectPath: z.string().describe("项目根目录的绝对路径"),
    eventNames: z
      .array(z.string())
      .describe(
        "需要检查的事件英文名列表，如 ['click_btn', 'page_view']"
      ),
  },

  handler: withErrorHandling(async (args) => {
    const { projectPath, eventNames } = args;
    const batchResult = await batchSearchEventsInCode(
      projectPath,
      eventNames
    );
    return successResponse(computeCoverage(eventNames, batchResult));
  }, "检查埋点覆盖率失败"),
};
