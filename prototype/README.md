# Capability Atlas 0.6 / 能力测绘台

Capability Atlas 把“一个功能需要哪些能力”映射到本机 Agent Skills，并明确显示：已覆盖、部分覆盖、仅有候选、完全缺失，以及 Skill 是否经过运行验证、是否需要优化。

0.6 在能力工作流与 Skill 安装闭环之上加入“从目标到开发手册”的产品链路：Agent 先建立结构化 Project Brief 草案，网页通过引导表单补齐并冻结不可变版本；系统再把固定九阶段专家骨架、项目上下文与步骤级 Skill 证据编译为 Playbook。用户可审阅内容哈希差异、人工确认版本、显式预览模板迁移、按步骤记录验收与证据，并把当前内容依次升级为“样例已跑通”和“初级开发者已验证”；Markdown 与 PDF 始终从同一事实源生成。Capability Atlas 只提供手册和受控安装，不会自动执行项目命令或 Skill。

## 启动网页

要求 Node.js 20 或更新版本。首次使用先安装锁定依赖：

```bash
cd /Users/mz/dev/skillsmap/prototype
npm install
npm run setup:pdf  # 首次启用 PDF 时需要；可安全重复执行
npm start
```

打开 <http://127.0.0.1:4317>。macOS 也可双击 [`启动能力测绘台.command`](./启动能力测绘台.command)；它会启动服务并打开网页。

网页首页只展示并选择本机服务中已有的工作流，不会根据网页自然语言输入创建流程。若列表为空，让 AI Agent 通过 MCP 创建草案后，网页会自动发现并打开它。“开发手册”面板负责补齐/冻结 Brief、生成手册、审阅差异、确认版本、记录人工执行进度与质量门，以及导出 Markdown/PDF；工作区继续负责工作流确认和安装回执单。所有冻结、确认、进度和安装执行动作都只在网页开放。

`npm run setup:pdf` 会在 `prototype/.venv` 创建或复用隔离 Python 环境并安装锁定的 ReportLab，不修改系统 Python；重复运行不会清空已有环境。MCP 连接不会静默安装或联网下载 PDF 依赖；未安装时网页会给出明确命令。可用 `CAPABILITY_ATLAS_PDF_PYTHON` 指定已有 ReportLab 的 Python，用 `CAPABILITY_ATLAS_PDF_FONT` 指定支持中文的 TrueType 字体。

## 连接 AI Agent

MCP 入口是绝对路径：

```text
/Users/mz/dev/skillsmap/prototype/mcp-server.mjs
```

常见本机 Host 的配置命令：

```bash
# Codex CLI
codex mcp add capability-atlas -- node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs

# Claude Code（当前项目作用域）
claude mcp add --scope local capability-atlas -- node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs

# Gemini CLI（当前项目作用域）
gemini mcp add --scope project capability-atlas node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs
```

无需配置 LLM API Key；模型、登录、对话和工具审批由 Host 负责。不要在普通终端里把 `npm run mcp` 当作交互命令使用：`stdio` Server 会等待 Host 从标准输入发送协议消息。

连接可信 MCP 后会**自动启动网页后台服务**，无需再让 Agent 重拉可视化任务。`mcp-server.mjs` 会先探测 `127.0.0.1:4317`：若已有健康的 Capability Atlas 实例就直接复用；端口空闲时才以独立子进程启动 `server.mjs`；若端口属于其他应用则不会接管，并在 MCP stderr 给出明确警告。正常断开连接会回收自己启动的子进程；若 Host 或沙箱异常回收 MCP，而 Web 子进程仍存活，下次连接会通过健康探测复用它。

自动启动只保证服务就绪，**不会擅自弹出浏览器窗口**。可以直接访问 <http://127.0.0.1:4317>，或在用户明确要求打开界面时调用 `open_web_ui`；该工具会再次确认服务健康并打开本机浏览器。默认端口可用 `CAPABILITY_ATLAS_WEB_PORT` 修改；如需恢复按需启动，可在 MCP 环境中设置 `CAPABILITY_ATLAS_WEB_AUTOSTART=0`。

所有网页服务和 MCP 子进程默认共享以下持久化文件：

```text
~/Library/Application Support/Capability Atlas/workspace.json
```

测试或隔离环境可通过 `CAPABILITY_ATLAS_DATA_DIR` 改变目录。网页和 Agent 必须使用相同值，才能看到同一批工作流。

默认共享 Skill 根固定为 `~/.agents/skills`，不能从网页输入任意安装路径。测试可用专用的 `CAPABILITY_ATLAS_HOME_DIR` 将扫描和安装根整体指向临时 HOME；自动测试从不写入真实 `~/.agents/skills`。安装日志、快照、所有权清单和隔离区位于 Capability Atlas 数据目录，默认保留 30 天。

## MCP 工具

- `atlas_status`：有界的清单统计和持久层状态。
- `search_skills`：分页搜索，不返回 Skill 正文或绝对路径。
- `get_skill`：读取单项元数据、警告和就绪度。
- `get_skill_content`：显式读取一份受限正文；返回内容始终标记为不可信数据。
- `list_workflows` / `get_workflow`：读取全局模板、项目实例和确认历史元数据。
- `get_workflow_version`：读取一个不可变人工确认快照及其内容指纹绑定的 Skill 判断。
- `get_project_brief` / `get_project_brief_version`：读取当前 Brief 或不可变冻结版本。
- `create_project_brief_draft` / `update_project_brief_draft`：建立并按 `completeness.nextQuestion` 补齐结构化访谈草案；不能冻结。
- `get_playbook` / `get_playbook_version`：读取当前手册或不可变人工确认版本。
- `get_playbook_diff`：读取当前草案相对不可变基线的结构化差异，以及网页确认必须复核的内容哈希。
- `get_playbook_template_status` / `preview_playbook_template_migration`：检查模板标识、版本和内容指纹，读取升级差异与进度/验证证据影响。
- `migrate_playbook_template_draft`：使用刚预览的稳定审阅哈希显式创建模板迁移草案；不会确认版本，也不会静默套用新模板。
- `generate_playbook_draft`：从已冻结 Brief、九阶段模板和本机 Skill 评估显式生成/重新生成手册草案。
- `export_playbook`：从同一 Playbook/Brief 来源导出有界 JSON 或 Markdown；PDF 由网页下载端点生成。
- `get_playbook_progress`：只读人工执行进度、质量门和旧内容哈希会话；MCP 不能代替用户打勾。
- `get_playbook_verification`：只读当前验证等级、样例运行就绪度、当前/旧内容哈希的验证证据；MCP 不能创建验证记录。
- `create_requirement_workflow_draft`：用结构化需求选择 Android、Web 或通用参考流程并建立草案。
- `create_workflow_draft` / `update_workflow_draft`：创建任意领域流程或修改 Agent 草案；修改必须携带预期修订号。
- `propose_workflow_change`：提交带 Agent 名称、理由和置信度的建议。
- `assess_workflow`：返回五维匹配、必需能力缺口、Skill 就绪度、优化建议和失效判断。
- `find_external_skills`：只针对明确缺口查询公共 Skills 索引；不安装、不执行。
- `record_external_skill_candidate`：把外部候选、来源、安全备注和状态绑定到具体能力缺口。
- `propose_skill_installation_plan`：从人工确认的本地匹配和已接受的外部缺口候选生成安装计划；只写工作流计划，不执行命令。
- `get_skill_installation_status`：读取脱敏计划状态、内容指纹、目标 Agent、扫描结果和重评摘要；不返回绝对路径、命令或隔离位置。
- `export_workflow`：导出无绝对路径的 JSON 或 Markdown。
- `open_web_ui`：用户明确要求时，打开由连接器自动托管的本地网页；若后台意外退出会先重新拉起。

MCP 还提供 Prompt `map_requirement_to_workflow` 来串起推荐调用顺序。刻意没有 `confirm_workflow` 或安装执行工具；Agent 可提案，文件系统写入必须回到网页由用户确认。

## 推荐使用流程

### 生成并使用开发手册

1. Agent 调用 `create_requirement_workflow_draft` 保存结构化需求；系统选择 Web、Android 或通用能力参考，并同时种下 Project Brief 草案。
2. Agent 读取 `completeness.nextQuestion`，用 `update_project_brief_draft` 逐项补齐项目名、问题、用户、首要结果、范围、非目标、约束、成功标准、平台和技术栈。网页也可以直接编辑这些字段。
3. 用户在网页核对并冻结 Brief。冻结会产生不可变版本；MCP 没有冻结工具。
4. Agent 或网页调用 `generate_playbook_draft`。Web 黄金路径会采用固定九阶段、18 个可执行步骤；每个阶段先给出 Skill 执行地图，每一步再明确主/备 Skill、确认状态、负责范围、使用到什么程度、所需证据、产出、验收与人工回退。通用操作、提示词和失败恢复只作为折叠参考，不代替 Skill 完成尺度。
5. 用户在网页查看 `get_playbook_diff` 同源差异和当前内容哈希。九个阶段不能删除；不适用阶段必须保留最低判断并填写原因。确认必须提交刚刚审阅的内容哈希，随后生成不可变版本并升级到“维护者已审”。
6. 模板标识、版本或内容指纹变化时，系统阻止普通重新生成。用户必须先预览结构化差异及旧进度/验证记录影响，再用预览审阅哈希创建新草案，并重新确认；旧确认版本和证据不会被删除。
7. 已确认手册可开始人工执行记录。执行者先按阶段 Skill 地图选择主 Skill，持续使用到绑定的完成条件全部满足；主 Skill 不适用或证据不足时才切换备用 Skill。任何阶段通过质量门前都要求本阶段全部步骤完成且验收通过，硬门还要求每个步骤已经保存证据；后续阶段只有在依赖阶段的门已通过或确认不适用后才能开始。重新生成后，旧内容哈希的进度会话保留但不会套用到新手册。
8. 完成所有适用步骤和质量门后，网页可保存带环境与证据的“样例已跑通”记录；随后可用匿名测试者画像、无需/有限协助和证据升级为“初级开发者已验证”。两级必须按序、绑定内容哈希且只能由 Web human actor 写入。
9. 网页可下载同源 Markdown 或 PDF。两者都带冻结 Brief、模板/工作流来源、Playbook 内容哈希和当前验证记录；PDF 只是渲染结果，不是新的事实源。

### 为步骤补齐或安装 Skill

1. 调用 `atlas_status` / `search_skills` 获取已启用、兼容当前 Agent 的本机事实，再用 `assess_workflow` 查看文本匹配、必需能力覆盖、运行就绪、来源质量和证据置信。
2. 只对 `missing` 的必需能力调用 `find_external_skills`；检查发布者、许可证、脚本和权限后，用 `record_external_skill_candidate` 记录候选。此步骤不安装 Skill。
3. 用户在网页确认、标记部分或排除候选；只有 `decision=confirmed` 的本地 Skill，以及 `status=accepted` 且绑定必需能力缺口的外部候选，具备安装准入资格。
4. Agent 可调用 `propose_skill_installation_plan`，或用户在网页选择目标 Agent 后生成计划。若当前工作流已经确认，创建安装计划会开启新草案，旧确认快照不变。
5. 用户在网页检查共享路径、Agent 链接、命令预览、同名冲突和逐项风险；保存选择后再次确认执行。高风险覆盖必须逐项勾选，普通项目可批量确认。
6. 后台事务逐 Skill 执行。成功项保留，失败项独立回滚；高/严重发现立即断链并隔离，中/低发现保留但等待人工审阅。完成后重新扫描并按每个目标 Agent 复评，页面显示“已安装，等待 Agent 重新加载”。

## 数据与版本语义

- 能力项是核心单位，Skill 只是覆盖能力的证据；不使用“文件数量等于能力数量”的模型。
- 目录镜像按内容指纹去重，包内部 `.agents/.cursor/.claude/...` 分发副本不重复计入；`disable: true` 的 Skill 可见但不进入匹配。
- Agent 兼容范围来自 Skill 声明或安装根；评估可指定目标 Agent，不兼容项不进入候选。
- 工作流分为可复用全局模板和项目实例。
- Project Brief、Playbook 和工作流分别维护修订号与不可变人工确认版本；修改其中一个不会覆写其他快照。
- Playbook 明确引用工作流版本、冻结 Brief 版本以及人工策划模板的标识、版本与内容指纹；模板变化必须预览后显式迁移。内容哈希覆盖手册实质内容，确认时必须与刚审阅的哈希一致。
- 步骤级 Skill 绑定来自当次脱敏评估，只是证据与人工回退建议，不代表 Skill 已安装或运行成功。
- 执行进度绑定 `playbookId + contentHash`；重新生成或编辑内容后旧会话保留为 stale，避免把旧证据误套到新手册。
- 样例运行与初级开发者验证是追加式证据记录，绑定 `playbookId + contentHash + progressRevision`；内容变化后记录转为 stale，验证等级重置。旧版曾把验证等级计入内容哈希，读取时会按 `playbookContentHashVersion` 安全迁移引用，不会孤立已有进度。
- 每次修改增加工作流修订号；并发写入使用乐观锁，旧修订不会覆盖新修订。
- 人工确认生成不可变版本快照，保存工作流、能力项、Skill 内容指纹、判断来源、时间，以及确认当时的脱敏本机评估摘要。
- 内容指纹相同时，Skill 移动或出现副本可复用判断；正文变化后，旧判断显示为待复核。
- 备份包含共享工作流、确认历史和自定义根，不包含 Skill 正文；恢复采用合并，不删除现有数据。
- 浏览器 `localStorage` 只保存当前选择、界面偏好和旧版兼容数据，不再是工作流事实源。
- 安装计划直接保存在工作流中，并绑定 `workflowId + revision + contentHash`；修订变化会拒绝执行旧计划。
- 全局同时只运行一个安装事务，进程间使用文件锁。异常中断不会自动续跑，而是进入待修复状态，由用户选择回滚、隔离或接受当前状态。

## 信任边界

```text
本机 Skill 目录 ──只读扫描──> CatalogService ──脱敏/分页──> MCP Host
                              │                         │
                              ├──确定性匹配─────────────┤
                              └──同源手册编译───────────┤
                                                        ▼
网页 ───────────────> 共享版本化 JSON 持久层 <── Agent 工作流/Brief/Playbook 草案
  ├──冻结 Brief / 模板迁移审阅 / 确认手册 / 人工进度与验证（网页专属）
  ├──同源导出 Markdown / PDF
  └──显式执行确认──> 单事务安装器 ──> 共享根/Agent 链接 ──> 扫描/隔离/复评
```

- 默认网页只监听 `127.0.0.1`；MCP MVP 仅使用本机 `stdio`，没有远程端口。
- 默认 MCP 结果不包含 `searchText`、完整正文或全部绝对路径。
- Skill 正文可能包含提示注入；只有显式单项读取工具会返回正文，并附带不可信标记。
- 扫描单文件最多 512 KB、单根最多 2,000 份；自定义根最多 20 个，并拒绝磁盘根和整个主目录。
- 静态匹配不能证明运行成功。“人工验证可用”必须绑定具体内容指纹和使用环境。
- 五维分数是可解释的检索启发式，不是成功概率；宽泛词和仅正文命中会降为弱证据。
- 外部查询会访问公共 Skills 索引，返回内容不可信；记录或接受候选不会自动安装。只有网页确认过的计划能启动 `npx skills add`，且安装结果仍不等于运行验证。
- 安装器不使用 shell 拼接或 `sudo`，不接受任意 URL、包或目标路径；网络失败不自动重试，手动重试重新获取当时最新版本。
- 同名不同内容默认保留。替换必须逐项确认并先做快照；“移除”只处理 Capability Atlas 拥有的链接/来源并移入隔离区，不删除原始本地 Skill。
- 网页确认代表本机 UI 中的明确确认动作，不是密码学意义上的真人身份认证。

## 命令与验证

```bash
npm run scan
npm run scan -- --full
npm run plan -- "开发一个 Web 应用" --json
npm run setup:pdf
npm run mcp
npm test
node --check public/app.js
python3 -m py_compile scripts/render-playbook-pdf.py
zsh -n 启动能力测绘台.command
```

当前自动测试还覆盖临时 HOME 内的本地链接同步、外部命令风险确认、安装后重新发现、高风险隔离、MCP 路径脱敏和安装计划准入；测试使用模拟 CLI，不写真实 Skill 根。详见 [`VALIDATION.md`](./VALIDATION.md)。

## 从 0.5 升级

- 先在网页工作区下载备份，再替换代码并运行 `npm install`；需要 PDF 时额外运行 `npm run setup:pdf`，该命令可重复执行。
- 工作区仍使用 `schemaVersion: "1"`，0.6 只增加可选集合。读取旧 0.5 数据时会把 Brief、Playbook、确认历史和进度初始化为空，不会改写现有工作流、确认版本或安装回执。
- 旧工作流不会自动生成或确认手册。选择工作流后进入“开发手册”，创建/补齐 Brief，由用户冻结，再显式生成 Playbook。
- 已生成手册绑定模板标识、版本和内容指纹。旧手册缺少指纹或模板内容变化时，页面会要求“预览模板迁移 → 应用为新草案 → 审阅确认”；普通重新生成会被拒绝，旧版本、进度和验证记录仍保留。
- 0.6 会把旧版“验证等级参与内容哈希”的确认/进度引用迁移到稳定哈希 v2；迁移只重绑可唯一证明属于同一 Playbook/快照的旧哈希，不改变手册内容。
- 0.6 MCP 只会复用健康检查版本同为 `0.6.0` 的 Web 服务。若 4317 上仍是 0.5，请关闭旧进程后重新连接可信 MCP。

## 当前边界

- SkillsMap 不内置 LLM；Android/Web/通用模板只是参考，其他领域和具体裁剪仍由外部 Agent 提案、人工确认。
- 公共 Skills 搜索必须由 Agent/用户针对明确缺口显式触发；记录或接受不会自动安装。安装只能由网页确认计划触发。
- 当前匹配仍是可解释的确定性文本证据，不是语义模型或运行评测。
- Web 产品路径拥有完整九阶段人工策划模板；其他领域当前使用通用回退结构，仍需领域专家审阅与补充。
- “样例已跑通”和“初级开发者已验证”已有按序、内容哈希绑定的独立证据记录，但仍依赖本机 Web human actor 填写；系统不验证真实身份，也不会自动重放项目或替代独立用户研究。
- 手册执行与质量门均为人工记录；尚未实现命令执行器、沙箱审批、自动证据采集或项目状态双向同步。
- PDF 依赖本机隔离 ReportLab 环境和可嵌入的中文 TrueType 字体；不会在 MCP 建连时自动安装依赖。
- 当前安装验证止于静态扫描、Agent 重新发现和工作流复评；不会自动运行 Skill，也不会自动重启 Agent。
- 尚未实现 MCP Apps 内嵌界面、Streamable HTTP、云同步或团队身份系统。
- 网页通过短轮询同步多进程修改，不是多人实时协同编辑器。

## 关键文件

- [`mcp-server.mjs`](./mcp-server.mjs)：标准 stdio MCP Server 和工具定义。
- [`lib/catalog-service.mjs`](./lib/catalog-service.mjs)：网页与 MCP 共用的扫描、搜索、正文边界和评估服务。
- [`lib/workflow-store.mjs`](./lib/workflow-store.mjs)：原子 JSON 持久化、乐观锁、确认快照和安全合并。
- [`lib/workflow-model.mjs`](./lib/workflow-model.mjs)：有序阶段、能力项、来源和确认约束。
- [`lib/project-brief-model.mjs`](./lib/project-brief-model.mjs)：引导式项目输入、完整度和冻结约束。
- [`lib/playbook-model.mjs`](./lib/playbook-model.mjs)：九阶段/步骤、质量门、Skill 绑定、验证等级与内容哈希。
- [`lib/playbook-compiler.mjs`](./lib/playbook-compiler.mjs)：人工策划骨架与冻结项目上下文的同源编译。
- [`lib/playbook-skill-binder.mjs`](./lib/playbook-skill-binder.mjs)：步骤级主/备 Skill、就绪度、缺口和人工回退。
- [`lib/playbook-diff.mjs`](./lib/playbook-diff.mjs)：确认前的有界结构化差异。
- [`lib/playbook-renderer.mjs`](./lib/playbook-renderer.mjs) / [`lib/playbook-pdf.mjs`](./lib/playbook-pdf.mjs)：同源 Markdown/PDF 交付。
- [`lib/playbook-progress-model.mjs`](./lib/playbook-progress-model.mjs)：内容哈希绑定的步骤、验收、证据和质量门记录。
- [`lib/playbook-verification-model.mjs`](./lib/playbook-verification-model.mjs)：样例就绪判断、按序验证等级和追加式人工证据记录。
- [`lib/matcher.mjs`](./lib/matcher.mjs)：能力覆盖与 Skill 就绪度评估。
- [`lib/skill-search.mjs`](./lib/skill-search.mjs)：有界外部候选查询与解析；无安装行为。
- [`lib/install-plan.mjs`](./lib/install-plan.mjs)：安装准入、最小能力覆盖和修订绑定。
- [`lib/installation-manager.mjs`](./lib/installation-manager.mjs)：单事务执行、链接、快照、取消、所有权和隔离策略。
- [`lib/security-scan.mjs`](./lib/security-scan.mjs)：安装后的有界静态安全扫描。
- [`public/app.js`](./public/app.js)：共享工作流、Agent 建议、人工确认和安装回执单界面。
- [`public/playbook-ui.js`](./public/playbook-ui.js)：Brief、差异审阅、手册阅读、进度和导出界面。
