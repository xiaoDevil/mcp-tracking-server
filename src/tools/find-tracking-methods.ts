import { z } from "zod";
import { searchTrackingMethods } from "../core/method-searcher.js";
import { successResponse, withErrorHandling } from "./tool-helpers.js";

export const findTrackingMethodsTool = {
  name: "find_tracking_methods",
  description: `在项目代码中自动检测分析 SDK 并追踪埋点方法封装链。

**工作原理：**
1. 从 package.json 和代码 import 检测分析 SDK（神策、GrowingIO、友盟、诸葛IO、Mixpanel、Google Analytics 等）
2. 构建项目函数调用图
3. 自底向上追踪：SDK原始方法 → 一级封装 → 二级封装 → ...
4. 统计每个封装方法的调用次数
5. 推荐使用频率最高的最上层封装

**重要 - 调用后请务必验证：**
1. 查看 recommendations 中的推荐方法，优先使用最高层级且调用次数最多的封装
2. 如果 recommendations 为空但 trackingFiles 非空，读取 trackingFiles 中的 snippet 分析封装方式
3. 均为空时：搜索项目中 track/sensors/埋点 等关键词寻找封装方法
4. 禁止使用原始 SDK 调用，必须使用项目已封装好的方法
5. 禁止再次封装原始 SDK，要找到已有的封装方法使用
6. 多个 SDK 时，每个 SDK 有独立的推荐`,

  schema: {
    projectPath: z.string().describe("项目根目录的绝对路径"),
  },

  handler: withErrorHandling(async (args) => {
    const result = await searchTrackingMethods(args.projectPath);
    return successResponse(result);
  }, "搜索埋点方法失败"),
};
