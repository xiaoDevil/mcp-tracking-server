/** 格式化成功响应 */
export function successResponse(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** 格式化错误响应 */
export function errorResponse(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: true, message }),
      },
    ],
    isError: true,
  };
}

/** 统一的错误处理包装器 */
export function withErrorHandling(
  handler: (args: any) => Promise<any>,
  errorPrefix: string
) {
  return async (args: any) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : errorPrefix
      );
    }
  };
}
