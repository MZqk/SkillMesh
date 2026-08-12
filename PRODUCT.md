# SkillMesh 产品定义

SkillMesh 帮助用户回答三个问题：当前工作流需要哪些能力、本机哪些 Skill 有可信覆盖、应该按什么顺序使用这些 Skill。

核心体验是一个原生 MCP App 工作台：打开即扫描，不需要独立网页、前置表单或生成按钮；当前 MCP Host 决定 Quick Use 的目标 Agent；方案按目标 Agent 独立区分“目标端已就绪、其他 Agent 可同步、证据待确认、生态补充安装”。只有人工确认且具备强证据的 Skill 可以成为主 Skill，无可信主 Skill 的能力进入缺口区。

产品边界：

- 一个 `open_skillmesh` 入口承载测绘、Skill 方案、快速使用、安装和精简设置。
- 工作流、人工判断、安装记录与偏好持久化；Skill 使用方案即时计算且不持久化。
- WorkBuddy 与 Codex 使用同一套标准 MCP Apps 协议，不维护宿主私有桥接。
- Quick Use 使用 `ui/message`，只把任务交给当前宿主，不跨宿主调度，也不在 App 内展示 Agent 执行结果。
- Markdown/PDF 使用当前方案 `contentHash` 并通过 `ui/downloadFile` 下载。
- 外部 Skill 只从 Agent 针对明确缺口记录的候选进入审阅；App 重新获取单个 GitHub `SKILL.md`、展示完整原文与静态线索，并以人工接受的 SHA-256 约束安装，不提供宽泛商店。
- 安装、替换、兼容性覆盖、隔离与修复必须由 App 中的人工操作触发，并继续受修订、锁、内容哈希、扫描、回滚和隔离规则保护。
- SkillMesh 不调用 OpenAI/Anthropic 模型 API，不使用 MCP Sampling，不启动 HTTP 服务。
