#!/usr/bin/env python3
"""Generate the SkillsMap local-AI enablement research report."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

import yaml


ROOT = Path(__file__).resolve().parent
OUTLINE_PATH = ROOT / "outline.yaml"
FIELDS_PATH = ROOT / "fields.yaml"
RESULTS_DIR = ROOT / "results"
REPORT_PATH = ROOT / "report.md"

CATEGORY_TITLES = {
    "identity_and_scope": "对象与范围",
    "current_implementation": "当前实现证据",
    "architecture_and_protocol": "架构与协议",
    "zero_key_and_providers": "零外部 API Key 与本机 Agent",
    "security_and_operations": "安全与运维",
    "decision": "决策与实施",
    "evidence": "来源与不确定性",
}


def load_yaml(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def text_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    if isinstance(value, list):
        return "；".join(filter(None, (text_value(item) for item in value)))
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def markdown_value(value, depth: int = 0) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("http://", "https://")):
            parsed = urlparse(stripped)
            label = parsed.netloc.removeprefix("www.") + parsed.path.rstrip("/")
            return f"[{label}]({stripped})"
        if len(stripped) > 180 or "\n" in stripped:
            return "\n".join(f"> {line}" if line else ">" for line in stripped.splitlines())
        return stripped
    if isinstance(value, list):
        if not value:
            return ""
        rows = []
        for item in value:
            if isinstance(item, dict):
                cells = [f"**{key}**: {text_value(val)}" for key, val in item.items()]
                rows.append("- " + " | ".join(cells))
            else:
                rendered = markdown_value(item, depth + 1)
                rows.append(f"- {rendered}")
        return "\n".join(rows)
    if isinstance(value, dict):
        rows = []
        for key, nested in value.items():
            rendered = markdown_value(nested, depth + 1)
            if not rendered:
                continue
            if "\n" in rendered:
                indented = "\n".join(f"  {line}" for line in rendered.splitlines())
                rows.append(f"- **{key}**:\n{indented}")
            else:
                rows.append(f"- **{key}**: {rendered}")
        return "\n".join(rows)
    return str(value)


def uncertain_field_names(result: dict, known_fields: set[str]) -> set[str]:
    names = set()
    for entry in result.get("uncertain", []):
        prefix = str(entry).split("：", 1)[0].split(":", 1)[0].strip()
        if prefix in known_fields:
            names.add(prefix)
    return names


def main() -> None:
    outline = load_yaml(OUTLINE_PATH)
    fields_doc = load_yaml(FIELDS_PATH)
    groups = fields_doc["categories"]
    known_fields = {
        field["name"]
        for group in groups
        for field in group.get("fields", [])
    }

    ordered_results = []
    missing = []
    for item in outline["items"]:
        path = RESULTS_DIR / f"{item['id']}.json"
        if not path.exists():
            missing.append(path.name)
            continue
        ordered_results.append((item, load_json(path), path))
    if missing:
        raise SystemExit("缺少研究结果：" + ", ".join(missing))

    source_urls = sorted({
        source
        for _, result, _ in ordered_results
        for source in result.get("sources", [])
        if isinstance(source, str) and source.startswith(("http://", "https://"))
    })

    lines: list[str] = []
    add = lines.append
    add("# SkillsMap 当前启用方式与本机 AI 接入调研")
    add("")
    add(f"> 研究截止：{outline['current_date']}。范围：优先 MCP，其次由现有网页调用本机 CLI AI Agent；项目本身不要求配置外部 LLM API key。")
    add("")
    add("## 结论")
    add("")
    add("**建议采用“同一核心、两种交付、三层渐进”的架构。** 第一层保留现有独立网页；第二层把现有只读扫描、搜索、匹配和导出暴露成 stdio MCP Server；第三层只有在独立网页确实需要自由对话时，才加入受控的本机 Agent Gateway。MCP Apps 可作为 Host 内嵌网页增强，但不能替代无兼容 Host 时的普通 Web。")
    add("")
    add("这条路线满足“无需项目配置 LLM API key”，因为模型、登录和对话由用户已经登录的 AI Host 或本机 CLI 负责。它**不等于**无需账号、免费、离线，也不代表可以把任何供应商的个人订阅凭证用于对外产品。")
    add("")
    add("优先级如下：")
    add("")
    add("1. **P0：只读 stdio MCP Server。** 最贴合当前代码和信任边界，先不让 SkillsMap 自己负责模型推理。")
    add("2. **P1：MCP Apps 渐进增强。** 在支持的 Host 中嵌入交互视图；无 UI Host 仍返回结构化文本。")
    add("3. **P2：独立网页的本机 Agent Gateway。** Codex SDK/app-server 或 `codex mcp-server` 优先，Gemini ACP 次之；JSONL/headless 只作 fallback。")
    add("4. **P3：本地模型。** 只有明确要求真正离线时再引入 Ollama/LM Studio；当前机器未安装这两者。")
    add("")
    add("## 当前项目究竟如何启用")
    add("")
    add("当前 Capability Atlas 0.2 是一个无第三方 npm 依赖的本机 Node.js 应用，不包含 MCP、模型调用、AI CLI 子进程、API key 或鉴权。`plan` 是把有界扫描结果匹配到人工维护工作流的确定性规则，不是模型推理。")
    add("")
    add("| 使用方式 | 命令/入口 | 实际行为 |")
    add("|---|---|---|")
    add("| macOS 双击 | `prototype/启动能力测绘台.command` | 检查 Node 20，打开 `127.0.0.1:4317`，运行 `node server.mjs` |")
    add("| 网页服务 | `cd prototype && npm start` | 静态网页 + `/api/health`、`scan`、`plan`、`export` |")
    add("| CLI 启动服务 | `node cli.mjs serve` | 调用同一个 `startServer()` |")
    add("| CLI 扫描 | `npm run scan [-- --full]` | 只读扫描 `SKILL.md`，输出摘要或公开 inventory |")
    add("| CLI 地图 | `npm run plan -- \"目标\" [--json]` | 确定性匹配，输出 Markdown/JSON |")
    add("")
    add("代码证据集中在 [`prototype/server.mjs`](../prototype/server.mjs)、[`prototype/cli.mjs`](../prototype/cli.mjs)、[`prototype/lib/scanner.mjs`](../prototype/lib/scanner.mjs)、[`prototype/lib/matcher.mjs`](../prototype/lib/matcher.mjs) 和 [`prototype/public/app.js`](../prototype/public/app.js)。")
    add("")
    add("## 推荐目标架构")
    add("")
    add("```mermaid")
    add("flowchart TB")
    add('  Core["现有只读核心<br/>roots · scanner · matcher · exporter"]')
    add('  Web["现有独立 Web<br/>127.0.0.1:4317"] --> Core')
    add('  MCP["新增 SkillsMap MCP Server<br/>首选 stdio"] --> Core')
    add('  Host["已登录 AI Host<br/>ChatGPT/Codex · Claude · Gemini"] -->|"MCP tools/resources"| MCP')
    add('  Apps["可选 MCP Apps UI<br/>sandboxed iframe"] -->|"postMessage / JSON-RPC"| Host')
    add('  Browser["独立浏览器 Agent UI"] -->|"same-origin HTTP + SSE"| Gateway')
    add('  Gateway["可选本机 Agent Gateway<br/>能力探测 · 会话 · 审批 · 取消"] -->|"stdio"| Codex["Codex SDK / app-server / mcp-server"]')
    add('  Gateway -->|"stdio JSON-RPC"| Gemini["Gemini ACP"]')
    add('  Gateway -->|"JSONL fallback"| Claude["Claude/Gemini/Codex headless"]')
    add('  Gateway --> Core')
    add("```")
    add("")
    add("这里必须分清三个角色：MCP Server 提供工具和上下文；AI Host/本机 Agent 负责模型与对话；纯浏览器不能直接启动 stdio 进程。MCP 核心协议本身不会自动给项目增加 LLM。")
    add("")
    add("## 方案比较")
    add("")
    add("| 方案 | 项目需 LLM API key | 网页 | 会话/审批 | 与当前仓库匹配 | 判断 |")
    add("|---|---:|---|---|---:|---|")
    add("| SkillsMap 作为 stdio MCP Server | 否 | Host 原生 UI；工具结果 | 由 Host 负责 | **最高** | 首选 |")
    add("| stdio MCP + MCP Apps | 否 | Host 内嵌 iframe | 由 Host 负责 | 高 | 第二步；保留文本降级 |")
    add("| 网关作为 MCP Client 调 `codex mcp-server` | 否，复用 Codex 登录 | 独立 Web | Codex thread/reply；网关补 UI | 中高 | 严格 MCP 路径可做 spike |")
    add("| Codex SDK / app-server | 否，复用 ChatGPT 登录 | 独立 Web | thread/turn/审批/流式最完整 | 高 | 独立网页 AI 的首选 Provider |")
    add("| Gemini ACP | 否，可复用缓存 Google 登录 | 独立 Web | session/prompt/cancel/FS proxy | 高 | 第二 Provider |")
    add("| Codex/Gemini/Claude headless JSONL | 通常否，取决于缓存登录 | 独立 Web | 需要自建归一层 | 中 | 兼容 fallback |")
    add("| Claude 订阅 OAuth 作为分发产品后端 | 技术上可本机复用 | 独立 Web | JSONL/SDK | 低 | **不作为产品承诺** |")
    add("| Ollama/LM Studio 本地模型 | 否 | 独立 Web | 自建 | 中 | 真正离线的可选项 |")
    add("")
    add("## MCP 实施要点")
    add("")
    add("截至研究日，MCP `2026-07-28` 已将核心改为无状态：每个请求携带协议版本和能力，`server/discover` 用于能力发现；Streamable HTTP 移除了独立 GET stream 和协议级 session。MCP Apps 与 Tasks 是正式扩展。Sampling、Roots 和协议 Logging 已进入弃用期，因此新实现不应依赖 Sampling 来“向 Host 借模型”。")
    add("")
    add("首版工具建议：")
    add("")
    add("- `atlas_status`：版本、根摘要、扫描统计，不返回全部 Skill。")
    add("- `search_skills`：query/provider/scope/cursor/limit，强制分页。")
    add("- `get_skill`：按稳定内容 ID 获取公开元数据；默认无正文。")
    add("- `build_map`：目标 + 人工 override，返回摘要和分页阶段。")
    add("- `export_map`：返回 Markdown resource 或有上限文本。")
    add("")
    add("优先 stdio；只有出现多个客户端共享常驻服务的真实需求时，才增加 Streamable HTTP。不要手写协议栈：使用并锁定官方 SDK，同时保留 2025-era 客户端 fixture，验证实际 Host 的协议 revision 与 Apps/Tasks 能力。")
    add("")
    add("## 本机 AI Provider 结论")
    add("")
    add("| Provider | 官方控制面 | 零项目 Key 路径 | 本机状态 | 主要限制 |")
    add("|---|---|---|---|---|")
    add("| Codex | SDK；app-server；`mcp-server`；`exec --json` | ChatGPT 登录/订阅 | PATH 中 npm Codex 损坏；ChatGPT.app 内置 Codex 可运行 | 必须做候选路径健康探针；app-server 的网络传输成熟度需版本核对 |")
    add("| Gemini CLI | `gemini --acp`；headless `stream-json` | 缓存 Google 登录 | `0.46.0` 可运行 | ACP 与事件 schema 要锁版本；组织账号可能要求 Cloud project |")
    add("| Claude Code | `claude -p --output-format stream-json` | 非 bare 模式读取现有订阅登录 | `2.1.142` 可运行 | `--bare` 不读取 OAuth、会要求 API key；订阅 OAuth 不可作为第三方产品代用户路由 |")
    add("| Ollama / LM Studio | 本地模型 HTTP/runtime | 无外部账号 | 均未发现 | 需另装模型并做质量/资源基准 |")
    add("")
    add("Codex 当前探针尤其说明：`command -v` 成功不等于 CLI 可用。Provider discovery 应依次验证显式配置、PATH、macOS 应用内置二进制和 SDK 自带 runtime，并实际执行 `--version`/协议能力探针；不得读取或展示用户账号信息。")
    add("")
    add("## “无需外部 LLM API key”的准确边界")
    add("")
    add("- **可承诺：** SkillsMap 不要求用户粘贴 API key，不保存 API key，调用用户已经登录的本机 Host/CLI。")
    add("- **不可承诺：** 无需登录、永久免费、完全离线、无数据出站、任意个人订阅都允许被第三方产品复用。")
    add("- **只有本地模型才是离线：** Codex/Claude/Gemini 的订阅登录路径通常仍把选择的提示和上下文发送到供应商服务。")
    add("- **Claude 特别限制：** Anthropic 官方要求为他人构建产品或服务时使用 Console API key 或受支持云提供商，不允许代用户路由 Free/Pro/Max 凭证。因此 Claude 无 Key 桥接只能作为用户自用/受控实验，不应写入可分发产品卖点。")
    add("")
    add("## 安全门槛")
    add("")
    add("当前 REST 服务没有 Origin、Host、CSRF/nonce 或用户鉴权，这在只读原型里风险有限；一旦它能启动 Agent 子进程，就必须先改变安全模型：")
    add("")
    add("1. Agent 功能默认关闭，仅 `CAPABILITY_ATLAS_ENABLE_LOCAL_AGENT=1` 显式开启；开启时无条件拒绝非回环监听。")
    add("2. 对有副作用 API 精确校验 `Host`、`Origin`、`Sec-Fetch-Site`、JSON content-type 和一次性会话 nonce；不启用宽松 CORS。")
    add("3. Provider、可执行文件、argv、cwd、环境变量全部由服务端 allowlist 决定；使用 `spawn(executable, args, {shell:false})`，prompt 走 stdin，浏览器不能提交命令字符串。")
    add("4. 默认只读/plan 沙箱；写文件和外部命令必须由支持审批事件的协议映射到明确 UI 确认。永不传递跳过沙箱/跳过审批参数。")
    add("5. 限制 prompt、stdout/stderr、并发、运行时间和进程树；实现 AbortSignal、取消、SIGTERM 后升级终止和服务退出清理。")
    add("6. 继续默认不把 `searchText`、完整 SKILL.md 正文或全部路径交给云端 Agent；Skill 正文视为非信任输入，不得当系统指令。")
    add("7. 统一 Provider 事件为 `start/delta/tool/approval/error/done`，未知事件只记录并安全降级；日志不包含凭证、完整 prompt 或私有正文。")
    add("")
    add("## 最小代码落点")
    add("")
    add("| 文件 | 改动 | 阶段 |")
    add("|---|---|---|")
    add("| `prototype/lib/catalog-service.mjs` | 从 `server.mjs` 抽出 roots、cache、scan/search/plan/export 公共服务 | MCP 前置 |")
    add("| `prototype/mcp-server.mjs` | 官方 SDK + stdio，暴露只读 tools/resources | P0 |")
    add("| `prototype/package.json` | `mcp`、`inspect:mcp`、`test:mcp`；锁定 SDK | P0 |")
    add("| `prototype/public/transport-*.js` | REST 与 MCP Apps bridge 的传输适配 | P1 |")
    add("| `prototype/lib/agents/*` | Provider capability、Codex/Gemini/Claude adapters、事件归一 | P2 |")
    add("| `prototype/server.mjs` | gated agent health/session/event/cancel API，安全校验 | P2 |")
    add("| `prototype/public/app.js` / `index.html` | Provider 状态、对话流、审批、取消 | P2 |")
    add("| `prototype/test/mcp.test.mjs` / `local-agent.test.mjs` | 协议、假 CLI、安全、取消、隐私回归 | 各阶段 |")
    add("")
    add("## 推荐实施顺序")
    add("")
    add("1. **1–2 天：公共服务层。** 不改行为地抽取 inventory/plan/export，保持现有 14 个测试通过。")
    add("2. **2–3 天：stdio MCP 垂直切片。** `status/search/build_map/export`，Inspector + Codex/Claude/Gemini 至少两个 Host 实测。")
    add("3. **2 天：MCP Apps spike。** 只迁移一个地图/搜索视图；无 UI Host 验证文本降级。")
    add("4. **3–5 天：单 Provider Web Gateway。** 首选 Codex SDK/app-server；必须先完成 Origin/nonce/allowlist/取消/只读沙箱。")
    add("5. **后续：Gemini ACP 与 JSONL fallback。** 用协议 fixture 扩展，不先追求统一所有事件。")
    add("6. **Claude 与本地模型。** Claude 仅个人实验；本地模型在真正离线需求和质量基准成立后加入。")
    add("")
    add("## 验收标准")
    add("")
    add("- 未配置任何 LLM API key 时，已登录 Host 可调用 SkillsMap MCP 工具。")
    add("- 1,000+ Skill inventory 始终分页，默认响应没有 `searchText`、完整正文或测试 sentinel。")
    add("- 不支持 MCP Apps 的 Host 仍能完成同一工具工作流。")
    add("- Agent 功能默认关闭，非回环、错误 Origin、无 nonce、任意 executable/argv 请求全部失败。")
    add("- 假 CLI 覆盖登录过期、协议未知事件、超时、取消、非零退出、超大输出和进程树清理。")
    add("- 原有双击、`npm start`、scan、plan、export 和测试保持不变。")
    add("")
    add("## 证据边界")
    add("")
    add(f"本报告汇总 {len(ordered_results)} 个结构化研究项和 {len(source_urls)} 个去重官方来源。仓库结论来自当前工作区代码、测试与本机只读版本探针；技术结论优先使用协议、供应商官方文档和官方 SDK 说明。没有读取本机账号身份或凭据，也没有实际发起付费模型调用。")
    add("")
    add("仍需实测的部分：目标 Host 对 MCP `2026-07-28`、MCP Apps/Tasks 的实际支持；Codex/Gemini/Claude 在锁定版本下的事件 schema；本地模型质量和资源占用；任何对外分发前的供应商条款复核。")
    add("")
    add("# 分项研究明细")
    add("")

    for index, (item, result, path) in enumerate(ordered_results, start=1):
        add(f"<a id=\"item-{item['id']}\"></a>")
        add("")
        add(f"## {index}. {result.get('name', item['name'])}")
        add("")
        add(f"- 分类：`{result.get('category', item['category'])}`")
        add(f"- 结构化结果：`results/{path.name}`")
        if result.get("evidence_strength"):
            add(f"- 证据强度：{result['evidence_strength']}")
        add("")

        omitted = uncertain_field_names(result, known_fields)
        for group in groups:
            rendered_fields = []
            for field in group.get("fields", []):
                name = field["name"]
                if name in omitted:
                    continue
                value = result.get(name)
                if not text_value(value) or "[不确定]" in text_value(value):
                    continue
                rendered_fields.append((field, value))
            if not rendered_fields:
                continue
            add(f"### {CATEGORY_TITLES.get(group['category'], group.get('description', group['category']))}")
            add("")
            for field, value in rendered_fields:
                add(f"**{field['description']}**")
                add("")
                add(markdown_value(value))
                add("")

        if result.get("uncertain"):
            add("### 保留不确定性")
            add("")
            for entry in result["uncertain"]:
                add(f"- {entry}")
            add("")

    add("# 官方来源")
    add("")
    for index, source in enumerate(source_urls, start=1):
        parsed = urlparse(source)
        label = parsed.netloc.removeprefix("www.") + parsed.path.rstrip("/")
        add(f"{index}. [{label}]({source})")
    add("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"generated {REPORT_PATH} with {len(ordered_results)} items and {len(source_urls)} sources")


if __name__ == "__main__":
    main()
