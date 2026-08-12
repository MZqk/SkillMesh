# SkillMesh

SkillMesh 是面向 WorkBuddy 与 Codex 的原生 MCP App。它扫描本机 Agent Skills，将文本证据和人工判断映射到能力工作流，并在当前 Agent 对话中提供测绘、确认、安装、导出和快速使用工作台。

- [运行与开发说明](./prototype/README.md)
- [0.9 验收记录](./prototype/VALIDATION.md)
- [市场与 Agent 生态调研](./agent-skill-workflow-map-research/report.md)

0.9 只有一个用户入口：MCP 工具 `open_skillmesh` 打开的 `ui://skillmesh/workbench-v1.html`。不再启动 HTTP 服务，也不提供独立浏览器页面、直接模型 API、Skill Kit、workspace 备份恢复或扫描 CLI。

“Skill 使用方案”仍是无持久化的确定性快照。工作流、确认、Skill 人工判断、安装记录、设置、收藏和最近使用继续保存在本机 schema 2 workspace；每次打开工作台会重新扫描 Skill。Quick Use 通过标准 `ui/message` 将结构化指令发送到当前 WorkBuddy 或 Codex 对话，Markdown/PDF 通过 `ui/downloadFile` 下载。外部补充只允许审阅 Agent 针对明确缺口记录的单个候选，人工读取完整原文并绑定 SHA-256 后才能进入安装计划，不恢复宽泛 Skill 商店。

SkillMesh 不自动执行 Skill 或开发任务。只有原生 App 内的明确人工操作可以确认工作流或执行受控安装；模型可见工具只能创建草稿、评估、搜索、读取方案和提出安装计划。
