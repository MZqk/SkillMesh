# SkillMesh 0.7 / 技能测绘台

SkillMesh 把“一个功能需要哪些能力”映射到本机 Agent Skills，并明确显示：已覆盖、部分覆盖、仅有候选、完全缺失，以及 Skill 是否经过运行验证、是否需要优化。

0.7 在能力工作流与 Skill 安装闭环之上加入 Codex 原生 Quick Use Widget。用户明确要求查找、选择、收藏或使用 Skill 时，Codex 对话内只显示当前阶段最多 6 项、收藏最多 4 项、最近使用最多 4 项；任务、只读“当前 Codex”和预期产物在同一组件中完成，一次发送即可把结构化 handoff 追加到当前任务。网页与 Widget 共用服务端偏好修订，旧浏览器收藏和最近使用只迁移一次。SkillMesh 不会自动执行项目命令或 Skill。

## 启动网页

要求 Node.js 20 或更新版本。首次使用先安装锁定依赖：

```bash
cd /Users/mz/dev/skillsmap/prototype
npm install
npm run setup:pdf  # 首次启用 PDF 时需要；可安全重复执行
npm start
```

打开 <http://127.0.0.1:4317>。macOS 也可双击 [`启动技能测绘台.command`](./启动技能测绘台.command)；它会启动服务并打开网页。

网页首页只展示并选择本机服务中已有的工作流，不会根据网页自然语言输入创建流程。若列表为空，让 AI Agent 通过 MCP 创建草案后，网页会自动发现并打开它。“执行方案”面板会自动建立项目概况、后台保存修改、生成不同深度方案，并在用户正式开始时统一锁定执行基线；工作区继续负责 Skill 映射和安装回执单。安装、覆盖及隔离等写盘动作仍只在网页开放。

“Skill 标本册”现在分为两层：**本机事实**按内容指纹聚合同一 Skill 的全部 Agent/Provider 归属，并展示作用、显式 triggers、调用声明、保守调用提示、副本、来源和冲突；用户需要核对步骤、权限或副作用时，可点击读取单份限量本机 `SKILL.md`，读取前正文不进入浏览器，读取后仍只作不可信文本展示。**生态候选**由本机服务读取 [Skills Atlas](https://zita-go.github.io/Skills-Atlas/) 的公开 `data.json`，支持搜索、分类、来源、链式组合与排序筛选。同一功能组的多个公开来源可按许可证、更新时间、热度、安装映射和可绑定 Skill 横向对比；这些字段始终分开陈列，不折算成安全或质量总分。组合链详情按目录声明顺序展示覆盖账本：用精确名称标出本机发现项、当前缺口已记录项与待补项；只有逐项读取原文并取得服务端复核 SHA-256 的成员，才可原子记录到同一能力缺口。每项保留链名、组名和位置溯源，但不会因此自动接受、创建安装计划或宣称运行依赖。未命中规则不等于安全，原文不会交给模型，也不会被执行。目录查询可复制为深链接，`⌘/Ctrl + K` 可快速打开标本册。

日常使用无需进入完整标本册。“快速使用”只展示三组去重卡片：当前执行阶段最多 6 项、收藏最多 4 项、最近使用最多 4 项，优先级固定为当前阶段 → 收藏 → 最近使用。当前阶段优先读取 Playbook 的当前未完成步骤及 Skill 绑定，没有 Playbook 时才回退到技能地图当前阶段。网页与 Codex Widget 复用同一个快照服务、排序和 handoff 生成规则；收藏、最近使用、当前工作流和阶段保存在本机服务端，并用修订号避免并发覆盖。偏好不进入工作流事实、Playbook、Skill Kit 或安装判断。

借鉴 [Skills Atlas CLI 的 project kit](https://github.com/Zita-Go/Skills-Atlas/blob/main/packages/skills-atlas-cli/README.md)，安装回执单可把已保存选择导出为 `capability-atlas.skill-kit.json`。该文件是可提交的项目意图清单：稳定 SHA-256 覆盖工作流引用、目标 Agent、能力覆盖、所选 Skill 及组合链来源，不包含绝对路径、安装命令、确认记录或操作者。导入时仅比较本机清单与当前候选状态，区分内容一致、本地有改动、无指纹但同名、已禁用、已有候选和缺失；不会自动创建候选/计划、安装、移除或清理未声明的本机 Skill。

原文读取只访问与目录仓库一致的 GitHub Contents API，拒绝绝对路径、父目录跳转和重定向，单份上限 256 KB、超时 10 秒，并在本机内存缓存 30 分钟。匿名读取受 GitHub 额度限制；需要更高额度时可设置专用 `CAPABILITY_ATLAS_GITHUB_TOKEN`，该值只由服务端发送给 GitHub，不会下发浏览器。

`npm run setup:pdf` 会在 `prototype/.venv` 创建或复用隔离 Python 环境并安装锁定的 ReportLab，不修改系统 Python；重复运行不会清空已有环境。MCP 连接不会静默安装或联网下载 PDF 依赖；未安装时网页会给出明确命令。可用 `CAPABILITY_ATLAS_PDF_PYTHON` 指定已有 ReportLab 的 Python，用 `CAPABILITY_ATLAS_PDF_FONT` 指定支持中文的 TrueType 字体。

## 连接 AI Agent

MCP 入口是绝对路径：

```text
/Users/mz/dev/skillsmap/prototype/mcp-server.mjs
```

常见本机 Host 的配置命令：

```bash
# Codex CLI
codex mcp add skillmesh -- node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs

# Claude Code（当前项目作用域）
claude mcp add --scope local skillmesh -- node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs

# Gemini CLI（当前项目作用域）
gemini mcp add --scope project skillmesh node /Users/mz/dev/skillsmap/prototype/mcp-server.mjs
```

无需配置 LLM API Key；模型、登录、对话和工具审批由 Host 负责。不要在普通终端里把 `npm run mcp` 当作交互命令使用：`stdio` Server 会等待 Host 从标准输入发送协议消息。

连接可信 MCP 后会**自动启动网页后台服务**，无需再让 Agent 重拉可视化任务。`mcp-server.mjs` 会先探测 `127.0.0.1:4317`：若已有健康的 SkillMesh 实例就直接复用；端口空闲时才以独立子进程启动 `server.mjs`；若端口属于其他应用则不会接管，并在 MCP stderr 给出明确警告。正常断开连接会回收自己启动的子进程；若 Host 或沙箱异常回收 MCP，而 Web 子进程仍存活，下次连接会通过健康探测复用它。

自动启动只保证服务就绪，**不会擅自弹出浏览器窗口**。可以直接访问 <http://127.0.0.1:4317>，或在用户明确要求打开界面时调用 `open_web_ui`；该工具会再次确认服务健康并打开本机浏览器。默认端口可用 `CAPABILITY_ATLAS_WEB_PORT` 修改；如需恢复按需启动，可在 MCP 环境中设置 `CAPABILITY_ATLAS_WEB_AUTOSTART=0`。

所有网页服务和 MCP 子进程默认共享以下持久化文件。为兼容已有安装，数据目录继续沿用旧版路径：

```text
~/Library/Application Support/Capability Atlas/workspace.json
```

测试或隔离环境可通过 `CAPABILITY_ATLAS_DATA_DIR` 改变目录。网页和 Agent 必须使用相同值，才能看到同一批工作流。

默认共享 Skill 根固定为 `~/.agents/skills`，不能从网页输入任意安装路径。测试可用专用的 `CAPABILITY_ATLAS_HOME_DIR` 将扫描和安装根整体指向临时 HOME；自动测试从不写入真实 `~/.agents/skills`。安装日志、快照、所有权清单和隔离区位于上述兼容数据目录，默认保留 30 天。

### 安装仓库内 Codex 插件

仓库内插件位于 `plugins/skillmesh/`，marketplace 清单位于 `.agents/plugins/marketplace.json`。插件把现有 stdio MCP Server、Web Server、工作流模板、网页资源和单文件 Widget 预构建为自包含运行时；复制到 Codex 插件缓存后不依赖仓库外部路径，也无需现场安装 npm 依赖或编译。不包含 Hook、`.app.json`、自动安装或远程认证。

安装后可从以下三个入口开始：

- “打开 SkillMesh，选择当前阶段适用的 Skill。”
- “在 SkillMesh 中查看我的收藏和最近使用。”
- “用 SkillMesh 选择一个 Skill 并发送到当前 Codex。”

普通开发请求不会主动展示 Widget。只有明确的 Skill 查找、选择、收藏或使用意图才应调用 `open_skillmesh_widget`。

## MCP 工具

- `atlas_status`：有界的清单统计和持久层状态。
- `search_skills`：分页搜索，不返回 Skill 正文或绝对路径。
- `get_quick_skill_deck`：只读返回同源快速卡片快照、工作流选项和偏好修订；不打开 UI。
- `open_skillmesh_widget`：仅在明确 Skill 选用意图下打开 `ui://skillmesh/quick-use-v1.html` 原生组件；无 UI Host 仍能读取文字摘要与结构化快照。
- `update_quick_skill_state`：用乐观修订执行工作流/阶段切换、收藏或成功使用记录；过期修订返回冲突，不覆盖另一端状态。
- `get_skill`：读取单项元数据、警告和就绪度。
- `get_skill_content`：显式读取一份受限正文；返回内容始终标记为不可信数据。
- `list_workflows` / `get_workflow`：读取全局模板、项目实例和确认历史元数据。
- `get_workflow_version`：读取一个不可变人工确认快照及其内容指纹绑定的 Skill 判断。
- `get_project_brief` / `get_project_brief_version`：读取当前项目概况或已锁定的不可变版本。
- `create_project_brief_draft` / `update_project_brief_draft`：建立或调整自动补齐的项目概况草稿；草稿即可用于方案预览。
- `get_playbook` / `get_playbook_version`：读取当前执行方案或不可变基线版本。
- `get_playbook_diff`：读取当前草案相对不可变基线的结构化差异，以及网页确认必须复核的内容哈希。
- `get_playbook_template_status` / `preview_playbook_template_migration`：检查模板标识、版本和内容指纹，读取升级差异与进度/验证证据影响。
- `migrate_playbook_template_draft`：使用刚预览的稳定审阅哈希显式创建模板迁移草案；不会确认版本，也不会静默套用新模板。
- `generate_playbook_draft`：从当前项目概况和本机 Skill 评估生成/重新生成方案草案；`depth` 支持 `auto`、`quick`、`standard`、`full`。
- `export_playbook`：从同一 Playbook/Brief 来源导出有界 JSON 或 Markdown；PDF 由网页下载端点生成。
- `get_playbook_progress`：只读人工执行进度、质量门和旧内容哈希会话；MCP 不能代替用户打勾。
- `get_playbook_verification`：只读当前验证等级、样例运行就绪度、当前/旧内容哈希的验证证据；MCP 不能创建验证记录。
- `create_requirement_workflow_draft`：用结构化需求选择 Android、Web 或通用参考流程并建立草案。
- `create_workflow_draft` / `update_workflow_draft`：创建任意领域流程或修改 Agent 草案；修改必须携带预期修订号。
- `propose_workflow_change`：提交带 Agent 名称、理由和置信度的建议。
- `assess_workflow`：返回五维匹配、必需能力缺口、Skill 就绪度、优化建议和失效判断。
- `find_external_skills`：只针对明确缺口查询公共 Skills 索引；不安装、不执行。
- `record_external_skill_candidate`：把外部搜索线索以 `suggested` 状态绑定到具体能力缺口；MCP 不能把它标成已接受或伪造网页原文审阅。
- `propose_skill_installation_plan`：从人工确认的本地匹配和已接受的外部缺口候选生成安装计划；只写工作流计划，不执行命令。
- `get_skill_installation_status`：读取脱敏计划状态、内容指纹、目标 Agent、扫描结果和重评摘要；不返回绝对路径、命令或隔离位置。
- `export_workflow`：导出无绝对路径的 JSON 或 Markdown。
- `open_web_ui`：用户明确要求时，打开由连接器自动托管的本地网页；若后台意外退出会先重新拉起。

MCP 还提供 Prompt `map_requirement_to_workflow` 来串起推荐调用顺序。刻意没有 `confirm_workflow` 或安装执行工具；Agent 可提案，文件系统写入必须回到网页由用户确认。

## 推荐使用流程

### 从当前阶段快速使用 Skill

1. 在网页左栏点击“快速使用”，或在 Codex 明确要求打开 SkillMesh。两端都只读取当前执行阶段、收藏和最近使用，不展开数百项完整清单。
2. 从当前阶段卡片中选择一份 Skill；任务、阶段、步骤、预期产物和验收要求会从同源 Playbook 预填，仍可编辑。
3. Codex Widget 的目标固定为“当前 Codex”，通过标准 `ui/message` 追加任务；网页仍保留其他兼容 Agent 选项及普通浏览器复制降级。
4. 只有消息追加成功后 Widget 才记录最近使用；偏好同步失败只提示警告，不会重复发送。需要核对原文、来源或冲突时，再进入“Skill 标本册”。

### 生成并使用执行方案

1. Agent 调用 `create_requirement_workflow_draft` 保存结构化需求；系统选择 Web、Android 或通用能力参考，并同时生成完整、可编辑的项目概况草稿。
2. 网页默认展示项目名称、问题和期望结果，其他范围与技术字段按需展开。修改在后台自动保存；只有自动推断不准确时才需要补充。
3. Agent 或网页调用 `generate_playbook_draft`。项目概况仍是草稿也可以生成方案；`auto` 会根据风险和交付目标选择精简、标准或完整深度，也可显式选择 `quick`、`standard`、`full`。
4. 每个步骤顶部先用一行“本步使用”明确主 Skill、待确认建议或人工回退；备用 Skill、能力缺口、通用操作、提示词和失败恢复按需展开，产出与验收条件保持直接可见。
5. 用户查看当前方案及 `get_playbook_diff` 后，点击“锁定基线并开始执行”。系统一次性确认工作流、锁定项目概况、确认 Playbook，并创建内容哈希绑定的进度会话。
6. 模板标识、版本或内容指纹变化时，系统阻止普通重新生成。用户必须先预览结构化差异及旧进度/验证记录影响，再用预览审阅哈希创建新草案，并重新确认；旧确认版本和证据不会被删除。
7. 锁定后，项目概况和方案版本信息默认折叠，页面直接展开当前阶段。执行者按阶段 Skill 地图选择主 Skill并持续到完成条件满足，然后用一次“完成”操作同时记录步骤完成与验收通过；软门不再要求重复理由，硬门只在同一操作中要求一次证据。本阶段满足条件时质量门自动通过并展开下一阶段；进行中、失败、返工、手动改门和不适用设置保留在折叠的例外入口。重新生成后，旧内容哈希的进度会话保留但不会套用到新手册。
8. 完成所有适用步骤和质量门后，顶部下一步可直接聚焦“样例已跑通”：默认只填写结论和证据，样例名与项目上下文从锁定概况预填，环境差异与阻塞按需展开。随后用匿名测试者画像、结论和证据升级为“初级开发者已验证”，协助程度与阻塞项收在例外详情。两级仍必须按序、绑定内容哈希且只能由 Web human actor 写入。
9. 网页可下载同源 Markdown 或 PDF。两者都带生成时使用的精确项目概况快照、模板/工作流来源、Playbook 内容哈希和当前验证记录；PDF 只是渲染结果，不是新的事实源。

### 为步骤补齐或安装 Skill

1. 调用 `atlas_status` / `search_skills` 获取已启用、兼容当前 Agent 的本机事实，再用 `assess_workflow` 分开查看文本证据覆盖、人工确认覆盖、运行就绪、来源质量和证据置信。文本命中不能自动成为手册主 Skill。
2. 只对 `missing` 的必需能力调用 `find_external_skills`；Agent 可用 `record_external_skill_candidate` 保存 `suggested` 线索，但此步骤不能接受或安装 Skill。
3. 用户在网页读取精确原文、核对静态线索并记录服务端复核的 SHA-256。只有 `decision=confirmed` 的本地 Skill，以及绑定必需能力缺口、`status=accepted`、具有已审阅指纹且无高/严重线索的外部候选，具备安装准入资格。
4. Agent 可调用 `propose_skill_installation_plan`，或用户在网页选择目标 Agent 后生成计划。若当前工作流已经确认，创建安装计划会开启新草案，旧确认快照不变。
5. 用户在网页检查共享路径、Agent 链接、命令预览、同名冲突和逐项风险；保存选择后再次确认执行。高风险覆盖必须逐项勾选，普通项目可批量确认。
6. 后台事务逐 Skill 执行。成功项保留，失败项独立回滚；高/严重发现或安装内容与已审阅 SHA-256 不一致时立即断链并隔离，中/低发现保留但等待人工审阅。完成后重新扫描并按每个目标 Agent 复评，页面显示“已安装，等待 Agent 重新加载”。

若希望把这次选择随项目保存，在回执单的“项目 Skill Kit”区下载清单。团队成员可在自己的 SkillMesh 中导入并只读核对；缺失项仍需回到本机标本、生态候选和人工安装流程逐项处理。

## 数据与版本语义

- 能力项是核心单位，Skill 只是覆盖能力的证据；不使用“文件数量等于能力数量”的模型。
- 目录镜像按内容指纹去重，包内部 `.agents/.cursor/.claude/...` 分发副本不重复计入；同内容副本会合并全部 Provider 与兼容 Agent，不再由单一代表路径覆盖归属；`disable: true` 的 Skill 可见但不进入匹配。
- Agent 兼容范围来自 Skill 声明或安装根；评估可指定目标 Agent，不兼容项不进入候选。
- 工作流分为可复用全局模板和项目实例。
- 项目概况、Playbook 和工作流分别维护修订号与不可变基线版本；一次锁定动作会生成相互一致的正式快照，后续修改不会覆写旧基线。
- Playbook 草稿内嵌生成时使用的项目概况快照与内容指纹；锁定后改为引用不可变概况版本。模板变化必须预览后显式迁移，内容哈希覆盖方案实质内容。
- 步骤级 Skill 绑定来自当次脱敏评估；只有人工确认且具有强文本证据的候选可成为主 Skill，未确认候选只能作为建议备选并保留显式缺口，不代表已安装或运行成功。
- 执行进度绑定 `playbookId + contentHash`；重新生成或编辑内容后旧会话保留为 stale，避免把旧证据误套到新手册。
- 样例运行与初级开发者验证是追加式证据记录，绑定 `playbookId + contentHash + progressRevision`；内容变化后记录转为 stale，验证等级重置。旧版曾把验证等级计入内容哈希，读取时会按 `playbookContentHashVersion` 安全迁移引用，不会孤立已有进度。
- 每次修改增加工作流修订号；并发写入使用乐观锁，旧修订不会覆盖新修订。
- 人工确认生成不可变版本快照，保存工作流、能力项、Skill 内容指纹、判断来源、时间，以及确认当时的脱敏本机评估摘要。
- 内容指纹相同时，Skill 移动或出现副本可复用判断；正文变化后，旧判断显示为待复核。
- 备份包含共享工作流、确认历史和自定义根，不包含 Skill 正文；恢复采用合并，不删除现有数据。
- 浏览器 `localStorage` 只保存当前选择、界面偏好和旧版兼容数据，不再是工作流事实源。
- 安装计划直接保存在工作流中，并绑定 `workflowId + revision + contentHash`；修订变化会拒绝执行旧计划。
- Skill Kit 是安装计划所选项的稳定、路径无关意图快照；导入核对不改变工作流修订、候选、计划或本机文件。
- 全局同时只运行一个安装事务，进程间使用文件锁。异常中断不会自动续跑，而是进入待修复状态，由用户选择回滚、隔离或接受当前状态。

## 信任边界

```text
本机 Skill 目录 ──只读扫描──> CatalogService ──脱敏/分页──> MCP Host
                              │                         │
                              ├──确定性匹配─────────────┤
                              └──同源手册编译───────────┤
                                                        ▼
网页 ───────────────> 共享版本化 JSON 持久层 <── Agent 工作流/Brief/Playbook 草案
  ├──锁定执行基线 / 模板迁移审阅 / 人工进度与验证（网页专属）
  ├──同源导出 Markdown / PDF
  ├──已保存安装选择──> Skill Kit 意图清单 ──导入只读核对──> 本机清单/候选状态
  └──显式执行确认──> 单事务安装器 ──> 共享根/Agent 链接 ──> 扫描/隔离/复评

Skills Atlas data.json ──限时/限量拉取──> EcosystemCatalogService ──规范化/筛选──> 网页生态候选
                                         ├──精确 GitHub 路径──> 单份原文/指纹/静态线索（只读）
                                         └──服务端解析包名──> 能力缺口候选
```

- 默认网页只监听 `127.0.0.1`；MCP MVP 仅使用本机 `stdio`，没有远程端口。
- 默认 MCP 结果不包含 `searchText`、完整正文或全部绝对路径。
- Skill 正文可能包含提示注入；只有显式单项读取工具会返回正文，并附带不可信标记。
- 扫描单文件最多 512 KB、单根最多 2,000 份；自定义根最多 20 个，并拒绝磁盘根和整个主目录。
- 静态匹配不能证明运行成功。“人工验证可用”必须绑定具体内容指纹和使用环境。
- 五维分数是可解释的检索启发式，不是成功概率；宽泛词和仅正文命中会降为弱证据。
- 外部查询和原文审阅会访问公共索引/GitHub，返回内容不可信；原文只以文本展示，不交给模型或执行。可安装候选必须绑定服务端复核的原文 SHA-256；缺指纹或高风险线索会被计划门拦截，落盘内容漂移会断链并隔离。只有网页确认过的计划能启动 `npx skills add`，且安装结果仍不等于运行验证。
- 导入的 Skill Kit 是不可信项目数据：必须通过 schema、身份和意图哈希校验，且只参与比较；外部来源不会在导入时被读取或执行。
- 安装器不使用 shell 拼接或 `sudo`，不接受任意 URL、包或目标路径；Skills CLI 当前仍获取执行时的上游内容，因此 SkillMesh 用审阅 SHA-256 做失败关闭校验，而不声称远端版本已被 CLI 锁定。网络失败不自动重试。
- 同名不同内容默认保留。替换必须逐项确认并先做快照；“移除”只处理 SkillMesh 拥有的链接/来源并移入隔离区，不删除原始本地 Skill。
- 网页确认代表本机 UI 中的明确确认动作，不是密码学意义上的真人身份认证。

## 命令与验证

```bash
npm run scan
npm run scan -- --full
npm run plan -- "开发一个 Web 应用" --json
npm run setup:pdf
npm run mcp
npm run build:widget
npm run check:widget
npm run build:plugin
npm run check:plugin
npm run validate:plugin
npm test
node --check public/app.js
python3 -m py_compile scripts/render-playbook-pdf.py
zsh -n 启动技能测绘台.command
```

当前自动测试还覆盖临时 HOME 内的本地链接同步、外部命令风险确认、安装后重新发现、高风险隔离、MCP 路径脱敏和安装计划准入；测试使用模拟 CLI，不写真实 Skill 根。详见 [`VALIDATION.md`](./VALIDATION.md)。

## 从 0.6 升级

- 先在网页工作区下载备份，再替换代码并运行 `npm install`；需要 PDF 时额外运行 `npm run setup:pdf`，该命令可重复执行。
- 工作区仍使用 `schemaVersion: "1"`；0.7 新增独立的 `QuickSkillState v1`，不会改写现有工作流、确认版本、Playbook 或安装回执。
- 旧工作流不会自动生成或锁定方案。选择工作流并进入“执行方案”后，页面会自动建立完整项目概况；可直接生成方案，正式开始时再统一锁定基线。
- 已生成方案绑定模板标识、版本和内容指纹。旧方案缺少指纹或模板内容变化时，页面会要求“预览模板迁移 → 应用为新草案 → 审阅确认”；普通重新生成会被拒绝，旧版本、进度和验证记录仍保留。
- 首次 Web 启动会把旧 localStorage 收藏取并集、最近使用按最新时间去重，并在服务端有有效工作流时优先保留服务端选择。迁移成功即删除旧键；之后取消收藏不会被旧数据恢复。
- 0.7 MCP 只会复用健康检查版本同为 `0.7.0` 的 Web 服务。若 4317 上仍是 0.6，请关闭旧进程后重新连接可信 MCP。

## 当前边界

- SkillsMap 不内置 LLM；Android/Web/通用模板只是参考，其他领域和具体裁剪仍由外部 Agent 提案、人工确认。
- 公共 Skills 搜索必须由 Agent/用户针对明确缺口显式触发；记录或接受不会自动安装。安装只能由网页确认计划触发。
- 当前匹配仍是可解释的确定性文本证据，不是语义模型或运行评测。
- Web 产品路径拥有完整九阶段人工策划模板，但默认会按复杂度压缩为 3 或 5 阶段；其他领域当前使用通用回退结构，仍需领域专家审阅与补充。
- “样例已跑通”和“初级开发者已验证”已有按序、内容哈希绑定的独立证据记录，但仍依赖本机 Web human actor 填写；系统不验证真实身份，也不会自动重放项目或替代独立用户研究。
- 手册执行仍由人工触发；系统只会把同一次完成操作原子记录为步骤完成、验收通过，并在条件满足时推进质量门，不会自动运行命令、Skill 或采集证据。尚未实现命令执行器、沙箱审批或项目状态双向同步。
- PDF 依赖本机隔离 ReportLab 环境和可嵌入的中文 TrueType 字体；不会在 MCP 建连时自动安装依赖。
- 当前安装验证止于静态扫描、Agent 重新发现和工作流复评；不会自动运行 Skill，也不会自动重启 Agent。
- Skill Kit 当前是可验证意图与差异回执，不是自动同步器或包管理锁文件；已审阅外部项会携带期望内容指纹，无指纹的旧候选不能进入安装集合。
- 已实现本地 stdio MCP Apps 内嵌界面；尚未实现 Streamable HTTP、云同步、跨 Agent 直接投递或团队身份系统。
- 网页通过短轮询同步多进程修改，不是多人实时协同编辑器。

## 关键文件

- [`mcp-server.mjs`](./mcp-server.mjs)：标准 stdio MCP Server 和工具定义。
- [`lib/quick-skill-service.mjs`](./lib/quick-skill-service.mjs)：Web、MCP 与 Widget 共用的 Codex 兼容过滤、上下文回退和 6/4/4 快照服务。
- [`lib/quick-skill-state.mjs`](./lib/quick-skill-state.mjs)：收藏、最近使用、工作流/阶段与一次性旧状态迁移规则。
- [`widget/quick-use.js`](./widget/quick-use.js)：原生 MCP Apps 组件与 `ui/message` / 工具桥交互。
- [`scripts/build-plugin-runtime.mjs`](./scripts/build-plugin-runtime.mjs)：生成并校验可复制到 Codex 缓存的自包含插件运行时。
- [`lib/catalog-service.mjs`](./lib/catalog-service.mjs)：网页与 MCP 共用的扫描、搜索、正文边界和评估服务。
- [`lib/ecosystem-catalog.mjs`](./lib/ecosystem-catalog.mjs)：Skills Atlas 公开元数据代理、精确原文读取/缓存、安装前静态线索和受控候选解析。
- [`lib/workflow-store.mjs`](./lib/workflow-store.mjs)：原子 JSON 持久化、乐观锁、确认快照和安全合并。
- [`lib/workflow-model.mjs`](./lib/workflow-model.mjs)：有序阶段、能力项、来源和确认约束。
- [`lib/project-brief-model.mjs`](./lib/project-brief-model.mjs)：自动推断的项目概况、完整度、内容指纹和基线约束。
- [`lib/playbook-model.mjs`](./lib/playbook-model.mjs)：自适应阶段/步骤、质量门、Skill 绑定、验证等级与内容哈希。
- [`lib/playbook-compiler.mjs`](./lib/playbook-compiler.mjs)：3/5/完整深度骨架与精确项目概况快照的同源编译。
- [`lib/playbook-skill-binder.mjs`](./lib/playbook-skill-binder.mjs)：步骤级主/备 Skill、就绪度、缺口和人工回退。
- [`lib/playbook-diff.mjs`](./lib/playbook-diff.mjs)：确认前的有界结构化差异。
- [`lib/playbook-renderer.mjs`](./lib/playbook-renderer.mjs) / [`lib/playbook-pdf.mjs`](./lib/playbook-pdf.mjs)：同源 Markdown/PDF 交付。
- [`lib/playbook-progress-model.mjs`](./lib/playbook-progress-model.mjs)：内容哈希绑定的步骤、验收、证据和质量门记录。
- [`lib/playbook-verification-model.mjs`](./lib/playbook-verification-model.mjs)：样例就绪判断、按序验证等级和追加式人工证据记录。
- [`lib/matcher.mjs`](./lib/matcher.mjs)：能力覆盖与 Skill 就绪度评估。
- [`lib/skill-search.mjs`](./lib/skill-search.mjs)：有界外部候选查询与解析；无安装行为。
- [`lib/skill-kit.mjs`](./lib/skill-kit.mjs)：路径无关的项目 Skill 意图清单、稳定哈希校验和只读本机差异核对。
- [`lib/install-plan.mjs`](./lib/install-plan.mjs)：安装准入、最小能力覆盖和修订绑定。
- [`lib/installation-manager.mjs`](./lib/installation-manager.mjs)：单事务执行、链接、快照、取消、所有权和隔离策略。
- [`lib/security-scan.mjs`](./lib/security-scan.mjs)：安装前单文档与安装后目录共用的有界静态安全扫描。
- [`public/app.js`](./public/app.js)：共享工作流、Agent 建议、人工确认和安装回执单界面。
- [`public/playbook-ui.js`](./public/playbook-ui.js)：Brief、差异审阅、手册阅读、进度和导出界面。
