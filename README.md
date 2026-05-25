# mcp-tracking-server

通用埋点 MCP Server - 解析神策埋点文档，辅助 AI 自动埋点。

## 功能

| 工具 | 说明 |
|------|------|
| **parse_tracking_doc** | 解析神策格式的埋点 Excel 文档，提取自定义事件表 |
| **find_tracking_methods** | 搜索项目代码中已封装的埋点方法和 SDK |
| **check_tracking_coverage** | 检查项目代码中的埋点覆盖率 |

## 快速安装

### Claude Code / VS Code（Claude Code 扩展）

一行命令安装：

```bash
claude mcp add mcp-tracking-server -- npx -y @devil-q/mcp-tracking-server
```

或手动在项目级 `.claude/settings.json` / 全局 `~/.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "mcp-tracking-server": {
      "command": "npx",
      "args": ["-y", "@devil-q/mcp-tracking-server"]
    }
  }
}
```

### Cursor

在项目根目录 `.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "mcp-tracking-server": {
      "command": "npx",
      "args": ["-y", "@devil-q/mcp-tracking-server"]
    }
  }
}
```

### Windsurf

在项目根目录 `.windsurf/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "mcp-tracking-server": {
      "command": "npx",
      "args": ["-y", "@devil-q/mcp-tracking-server"]
    }
  }
}
```

### Cline / Roo Code（VS Code 扩展）

在 VS Code 设置中找到 MCP Servers 配置项，添加：

```json
{
  "mcpServers": {
    "mcp-tracking-server": {
      "command": "npx",
      "args": ["-y", "@devil-q/mcp-tracking-server"]
    }
  }
}
```

### 通用 JSON 配置

以下 JSON 适用于所有支持 MCP 的工具，复制到对应的配置文件即可：

```json
{
  "mcpServers": {
    "mcp-tracking-server": {
      "command": "npx",
      "args": ["-y", "@devil-q/mcp-tracking-server"]
    }
  }
}
```

## AI 使用示例

安装后，在 AI 工具中直接用自然语言触发：

```
# 解析埋点文档
帮我解析 "C:\Users\xxx\埋点文档.xlsx" 的埋点事件

# 查找项目中已有的埋点方法
找一下这个项目里用了哪些埋点 SDK 和封装方法

# 检查埋点覆盖率
检查这些事件 [click_btn, page_view] 在项目中的埋点覆盖率
```

## 发布

```bash
# 补丁版本 1.0.2 → 1.0.3
npm run release:patch

# 小版本 1.0.2 → 1.1.0
npm run release:minor

# 大版本 1.0.2 → 2.0.0
npm run release:major
```
