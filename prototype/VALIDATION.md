# SkillMesh 0.9 验收记录

## 当前结果

0.9 已将双运行时收敛为单一原生 MCP App：一个资源、一个 App 入口、标准 `serverTools`、`ui/message` 与 `ui/downloadFile`。独立 HTTP/Web、直接模型代理、旧 Widget、Skill Kit、workspace 备份恢复和 CLI 已从源码与插件产物删除。

自动化覆盖：

最后一次完整运行：`73` 项测试全部通过。

- WorkBuddy、Codex 与未知 Host 识别；未知 Host 只读。
- App 资源唯一性、模型/App 工具可见性以及旧工具缺失。
- Skill 方案自动深度、卡片准入、备选上限、目标 Agent 独立测绘、缺口与稳定哈希。
- App 人工判断、验证、确认、设置修订冲突与 schema 2 数据保留。
- 明确外部候选的 GitHub 原文读取、静态线索、哈希绑定、人工接受/拒绝与变更拒绝；不加载宽泛生态目录。
- `ui/message` 成功后才记录最近使用；拒绝不记录；偏好同步失败不重复发送。
- 安装计划、风险确认、锁、取消、扫描、回滚、隔离与修复。
- Markdown/PDF 精确哈希导出和 Host 下载数据格式。
- 自包含工作台、五区语义结构、键盘 Tab 模式、移动布局与 reduced-motion。
- 插件运行时不包含 HTTP server、旧 public 页面或旧 Widget。

完整验证命令：

```bash
npm test
node --check app/workbench.js
node --check mcp-server.mjs
python3 -m py_compile scripts/render-skill-plan-pdf.py
npm run check:app
npm run check:plugin
npm run validate:plugin
```

## 升级说明

版本为 `0.9.0`，workspace schema 保持为 `2`。原有工作流、确认、Skill 判断、安装记录、设置、收藏和最近使用不迁移也不清除。旧 Web、Widget、CLI 和 0.8 工具名不保留兼容入口；升级后需重新构建插件并重载 Agent Host。

## 已知边界

- Skill 匹配与人工确认不等于运行成功；只有用户填写的实际运行记录会标记为人工验证。
- `ui/message` 发送后的 Agent 结果只出现在当前 Host 对话，不回写 App。
- 其他 Agent Skill 可以显示为可同步或待安装，但 Quick Use 不进行跨 Host 调度。
- PDF 依赖隔离 Python/ReportLab 环境与可嵌入中文字体。
