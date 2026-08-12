# SkillMesh 0.9

SkillMesh 0.9 是单一原生 MCP App。MCP stdio server 扫描本机 Agent Skills，管理工作流与人工事实，并把自包含工作台资源交给 WorkBuddy 或 Codex 渲染。

## 开发与启动

```bash
npm install
npm run build:app
npm run mcp
```

项目不再监听 `127.0.0.1:4317`，也没有 `npm start`。需要 PDF 导出时先运行：

```bash
npm run setup:pdf
```

## Host 配置

WorkBuddy 可在 `~/.workbuddy/mcp.json` 中配置：

```json
{
  "mcpServers": {
    "skillmesh": {
      "command": "node",
      "args": ["/absolute/path/to/skillsmap/prototype/mcp-server.mjs"]
    }
  }
}
```

Codex 可使用仓库内 `plugins/skillmesh` 插件，或配置同一个 stdio 入口。配置完成后重载 Agent Host，并让 Agent 调用：

```text
open_skillmesh({ workflowId?, stageId?, targetAgents? })
```

## 原生工作台

- **测绘**：选择工作流和阶段，查看能力证据，记录确认、部分覆盖、排除及真实人工验证，并确认工作流版本。
- **Skill 方案**：即时显示自动深度、能力缺口和按顺序连接的可信 Skill 路线。
- **快速使用**：只显示兼容当前 WorkBuddy 或 Codex 的阶段相关、收藏和最近 Skill；通过 `ui/message` 发送。
- **安装**：审阅 Agent 针对明确缺口记录的单个外部候选，读取完整原文并绑定 SHA-256；随后创建修订绑定计划，配置项目、冲突与风险确认，并执行、取消、确认警告、隔离或修复。这里不提供宽泛 Skill 商店。
- **设置**：管理最多 20 个额外 Skill 根目录，校验后重新扫描。

App 在连接后检测 `serverTools`、`message`、`downloadFile` 和可用显示模式。未知 Host 保持只读；没有 `message` 或 `downloadFile` 能力时，对应操作直接禁用，不使用私有 API、剪贴板或浏览器下载回退。

## MCP 接口

唯一 App 入口与资源：

- `open_skillmesh` → `ui://skillmesh/workbench-v1.html`

模型可见工具继续负责 Skill 搜索/读取、工作流草稿、建议、评估、即时 Skill 方案、外部候选搜索、安装提案和状态读取。人工操作工具标记为 `_meta.ui.visibility: ["app"]`，包括工作流判断与确认、偏好与根目录、安装执行/取消/隔离/修复及方案文件准备。

`get_skill_usage_plan` 和工作台首屏都会基于最新清单计算 `SkillUsagePlan v1`，不写入 workspace。导出必须携带当前目标 Agent 与 `contentHash`；内容变化时返回 `skill-plan-changed`，App 刷新后才能再次下载。

## 数据与安全边界

- workspace schema 保持为 `2`，沿用原有数据目录，因此升级不会删除工作流、确认、人工判断、安装记录、收藏、最近使用或自定义根目录。
- 0.9 删除 workspace 导入导出公开能力，不创建升级备份。
- Skill 正文仍按不可信文本处理；只有明确选择单个 Skill 时才读取有界内容。
- 外部候选只支持可解析为确切 GitHub 仓库和 Skill 名称的安装包；接受或拒绝时会重新获取原文，内容变化会拒绝决定。安装后哈希不一致仍会触发隔离。
- 模型可见工具不能调用人工作为前提的安装执行。App-only 操作使用 `human/local-user/mcp-app` 身份。
- Quick Use 只发送到当前 Host。其他 Agent 的 Skill 可以参与测绘或安装计划，但不会被跨 Host 调度。
- Agent 执行结果留在 WorkBuddy/Codex 对话中，App 不维护 AI 任务或回调状态。

## 构建与验证

```bash
npm test
node --check app/workbench.js
node --check mcp-server.mjs
python3 -m py_compile scripts/render-skill-plan-pdf.py
npm run check:app
npm run build:plugin
npm run check:plugin
npm run validate:plugin
```

插件产物只包含 MCP server、自包含 workbench、工作流数据和 PDF 渲染脚本；不包含 HTTP server 或旧 `public` 目录。

## 破坏性升级

0.9.0 不兼容 0.8.x 的 `open_web_ui`、`open_skillmesh_widget`、Quick Deck 工具、Web API、Widget/CLI 脚本或端口入口。升级后必须重新构建插件运行时并重载 WorkBuddy/Codex。
