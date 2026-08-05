#!/usr/bin/env python3
"""Generate the decision report from the confirmed outline and validated result JSON files."""

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
    "identity": "对象身份与定位",
    "compatibility": "格式、路径与跨 Agent 兼容性",
    "inventory_features": "本地资产管理能力",
    "workflow_intelligence": "目标、工作流与能力缺口",
    "trust_and_governance": "隐私、安全与验证",
    "market_evidence": "需求、采用与商业证据",
    "decision": "对 SkillsMap 的决策影响",
}

# fields.yaml / result JSON may mix Chinese and English category keys.  The
# current corpus is flat, but keeping these aliases makes the report generator
# reusable for nested deep-research outputs too.
CATEGORY_ALIASES = {
    "identity": ["identity", "对象身份与定位", "身份与定位"],
    "compatibility": ["compatibility", "扫描、格式与跨 Agent 兼容性", "兼容性"],
    "inventory_features": ["inventory_features", "本地资产管理能力", "资产管理"],
    "workflow_intelligence": ["workflow_intelligence", "从目标到流程及能力缺口的能力", "工作流智能"],
    "trust_and_governance": ["trust_and_governance", "隐私、安全与验证状态", "信任与治理"],
    "market_evidence": ["market_evidence", "需求、采用和商业信息", "市场证据"],
    "decision": ["decision", "对项目决策的影响", "决策"],
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
        return "；".join(text_value(item) for item in value if text_value(item))
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def get_field(result: dict, field_name: str, category: str, category_description: str = ""):
    """Resolve flat and nested result shapes in the order required by the skill."""
    if field_name in result:
        return result[field_name]
    candidate_categories = [category, category_description, *CATEGORY_ALIASES.get(category, [])]
    for key in candidate_categories:
        nested = result.get(key)
        if isinstance(nested, dict) and field_name in nested:
            return nested[field_name]
    for nested in result.values():
        if isinstance(nested, dict) and field_name in nested:
            return nested[field_name]
    return None


def markdown_value(value, depth: int = 0) -> str:
    """Format scalar, list, and nested values without flattening away structure."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        value = value.strip()
        if len(value) > 100:
            return "\n".join(f"> {line}" if line else ">" for line in value.splitlines())
        return value
    if isinstance(value, list):
        if not value:
            return ""
        if all(isinstance(item, dict) for item in value):
            rows = []
            for item in value:
                cells = [f"**{key}**: {text_value(val)}" for key, val in item.items()]
                rows.append("- " + " | ".join(cells))
            return "\n".join(rows)
        simple = [text_value(item) for item in value if text_value(item)]
        if len(simple) <= 3 and sum(map(len, simple)) <= 100:
            return "，".join(simple)
        return "\n".join(f"- {item}" for item in simple)
    if isinstance(value, dict):
        rows = []
        for key, nested in value.items():
            rendered = markdown_value(nested, depth + 1)
            if "\n" in rendered:
                rows.append(f"- **{key}**:\n{rendered}")
            else:
                rows.append(f"- **{key}**: {rendered}")
        return "\n".join(rows)
    return str(value)


def source_label(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.removeprefix("www.") or "source"
    path = parsed.path.rstrip("/")
    tail = path.split("/")[-1] if path else ""
    if tail and len(tail) <= 48:
        return f"{host} · {tail}"
    return host


def uncertainty_fields(entries: list[str], known_fields: set[str]) -> set[str]:
    result: set[str] = set()
    for entry in entries:
        head = str(entry).split("：", 1)[0].split(":", 1)[0].strip()
        if head in known_fields:
            result.add(head)
    return result


def main() -> None:
    outline = load_yaml(OUTLINE_PATH)
    fields_doc = load_yaml(FIELDS_PATH)
    field_groups = fields_doc["categories"]
    field_names = {
        field["name"]
        for group in field_groups
        for field in group.get("fields", [])
    }

    ordered_results: list[tuple[dict, dict, Path]] = []
    missing: list[str] = []
    for item in outline["items"]:
        path = RESULTS_DIR / f"{item['id']}.json"
        if not path.exists():
            missing.append(path.name)
            continue
        ordered_results.append((item, load_json(path), path))
    if missing:
        raise SystemExit("缺少研究结果：" + ", ".join(missing))

    source_urls = sorted(
        {
            url
            for _, result, _ in ordered_results
            for url in result.get("sources", [])
            if isinstance(url, str) and url.startswith(("http://", "https://"))
        }
    )

    lines: list[str] = []
    add = lines.append
    add("# 本地 Agent Skill 盘点与工作流地图：市场与可行性决策报告")
    add("")
    add(f"> 研究截止：{outline['current_date']}。结论面向产品立项，不把公开条目数、论文指标或营销案例等同于真实付费需求。")
    add("")
    add("## 一句话结论")
    add("")
    add("**有条件继续，但不要开发‘又一个 Skill 扫描器’。** 建议把项目收窄为本地、跨 Agent、面向人的“结果规划层”：用户只给一个方向，系统调用版本化的专家参考流程，形成可解释的生命周期地图，再把本机能力映射为完整、部分、不确定、缺失四种状态。先做 7–10 天只读原型；在重复使用与匹配质量得到验证前，不投入通用执行器、市场、安装器或完整安全扫描。")
    add("")
    add("## 决策门")
    add("")
    add("| 决策门 | 判断 | 依据 |")
    add("|---|---|---|")
    add("| 问题是否存在 | **通过** | 多个独立 GitHub issue/discussion 与第一人称帖子反复出现目录分散、重复、作用域漂移、不会选、装了却不可发现等问题。 |")
    add("| 是否存在市场空白 | **部分通过** | 扫描、图谱、语义关系与多 Skill 编排已有强竞品；尚未找到把“非技术方向 → 专家生命周期 → 本机跨 Agent 四态覆盖/缺口”完整产品化的方案。 |")
    add("| 技术切入口是否成立 | **通过** | Agent Skills 标准及 Codex、Claude、Cursor 等生态可由只读适配器归一；差异主要在目录、作用域、扩展字段与加载语义。 |")
    add("| 用户是否会持续使用/付费 | **未验证** | 公开证据证明问题与替代行为，但不能替代真实用户的二次使用率、匹配纠错率与付费意愿。 |")
    add("")
    add("**立项判断：Conditional GO。** 可以做验证型原型，暂不批准完整产品开发。")
    add("")
    add("另一个立即动作：**不要继续把 `SkillsMap` 当对外产品名。** `skill-map.ai` 与 `@skill-map/cli` 已公开使用高度近似名称和相邻定位；当前仓库名可保留为内部代号，但在发布、域名或品牌投入前应更名并做商标/域名复核。")
    add("")
    add("## 为什么必须改定位")
    add("")
    add("截至研究截止日，三个方向已被明显占位：")
    add("")
    add("- [skill-map.ai](https://skill-map.ai/) 已提供 MIT 开源的本地 Web/CLI、Claude/Codex 等 Provider、关系图、冲突/孤儿/断链/重复/质量诊断、MCP 与实时活动。它直接覆盖扫描和现有 harness 地图；但其地图以已有文件和调用边为中心，未发现从模糊方向构建专家生命周期和四态缺口的功能。")
    add("- [SkillNet](https://github.com/zjunlp/SkillNet) 已能分析本地 Skill 目录的 `compose_with` / `depend_on` / 场景交接关系，并按自然语言任务选择 Skill、生成下游执行提示；但当前编排依赖预设场景和远程模型能力，未形成跨 Agent 本机实例治理与面向人的通用专家流程。")
    add("- [AgentSkillOS](https://arxiv.org/abs/2603.02176) 等研究已证明 capability tree、任务分解与 DAG 编排是活跃路线，因此“能力树/Skill 图/AI 编排”本身不是可主张的空白。")
    add("- Cursor、GitHub `gh skill` 与 JetBrains 已把跨目录发现和分层管理基础设施化；WorkBuddy Expert Team 与 QoderWork Expert Kit/Workbench 则已覆盖强目标拆解与执行。‘能扫多个目录’和‘AI 会拆任务’都不能单独成立为差异。")
    add("")
    add("因此，真正可测试的差异不是一个新图数据库，而是下面这条用户价值链：")
    add("")
    add("```mermaid")
    add("flowchart LR")
    add('  A["用户输入方向<br/>如：开发一个 Web 应用"] --> B["选择专家参考流程<br/>声明假设与适用边界"]')
    add('  B --> C["生成生命周期地图<br/>阶段·决策·交付物"]')
    add('  D["只读扫描本机<br/>多 Agent Skill 实例"] --> E["归一为 Capability<br/>来源·作用域·可信度"]')
    add('  C --> F["节点级能力匹配<br/>证据与置信度"]')
    add('  E --> F')
    add('  F --> G["完整 / 部分 / 不确定 / 缺失"]')
    add('  G --> H["渐进澄清与导出<br/>不安装·不执行"]')
    add("```")
    add("")
    add("## 核心竞合矩阵")
    add("")
    add("说明：✓ 明确覆盖；△ 部分或需组合；— 未见。这里比较产品表面，不代表质量等价。")
    add("")
    add("| 方案 | 本地/跨 Agent 盘点 | 关系或依赖图 | 目标驱动编排 | 专家生命周期模板 | 本机节点匹配 | 显式四态缺口 | 默认只读、本地 |")
    add("|---|---:|---:|---:|---:|---:|---:|---:|")
    add("| skill-map.ai | ✓ | ✓ | △ | — | △ | — | △ |")
    add("| SkillNet | △ | ✓ | ✓（场景受限） | △ | △ | — | — |")
    add("| AgentSkillOS | —（公共池） | ✓ | ✓ | — | △ | — | —（执行导向） |")
    add("| gh skill / Cursor / JetBrains | ✓ | — | △（Agent 自身） | — | △ | — | △ |")
    add("| npx skills / 其他管理器 | ✓ | — | — | — | — | — | △ |")
    add("| **建议中的 SkillsMap** | ✓ | △（复用上游） | **规划，不执行** | **✓** | **✓** | **✓** | **✓** |")
    add("")
    add("## 建议的 V0 原型")
    add("")
    add("只做一个黄金路径：**“从想法到上线 Web 应用”**。输入允许只有方向，不要求用户先给技术栈或程序员式任务清单。")
    add("")
    add("原型包含：")
    add("")
    add("1. 只读发现 Codex、Claude、Cursor 三个生态的 `SKILL.md`，保留实例路径、作用域、真实路径、内容哈希、名称和描述；inventory 接口允许接入 `gh skill list --json`、skill-map JSON/MCP 或直接文件扫描。")
    add("2. 一份由人策划并版本化的 Web 产品生命周期参考图；AI 只能在边界内裁剪、排序、提出假设和澄清问题。")
    add("3. 每个流程节点输出能力要求、候选本机 Skill、匹配理由、来源和置信度；用户可以确认或否决。")
    add("4. 覆盖状态严格分为完整、部分、不确定、缺失；“文件存在”不自动等于“能力已验证”。")
    add("5. 浏览器界面 + 最小 CLI；导出 Markdown/JSON。没有安装、写回、自动执行、市场或收费。")
    add("")
    add("优先复用而不是重造：评估把 `gh skill list --json` 和 `skill-map.ai` 的 JSON/MCP 图作为 inventory adapter；将 SkillNet/Graph of Skills 的依赖扩展思路作为匹配参考。上游均应通过可替换接口接入，避免把 preview CLI、年轻项目或第三方论文指标变成产品硬依赖与承诺。")
    add("")
    add("## 7–10 天验证计划")
    add("")
    add("| 天数 | 产物 | 验证问题 |")
    add("|---|---|---|")
    add("| 1–2 | 统一实例清单与去重规则 | 三个生态能否无执行地稳定扫描，并解释软链接、缓存和同名不同内容？ |")
    add("| 3–4 | Web 应用专家参考流程 v0 | 方向级输入能否得到用户看得懂、可纠正的阶段/决策/交付物？ |")
    add("| 5–6 | 节点匹配与四态缺口 | 候选是否有可复核证据；用户否决后能否保留纠正？ |")
    add("| 7 | 高层地图 + 逐层展开 + Markdown 导出 | 用户是否能在 10 分钟内理解“已有、缺什么、下一步是什么”？ |")
    add("| 8–10 | 3–5 个 AI 模拟案例 + 本机 dogfood | 相同方向不同约束是否产生合理差异；第二次使用是否仍有价值？ |")
    add("")
    add("没有访谈条件时，AI 可继续承担资料归纳、竞品试走、公开问题编码和合成场景压力测试；但 AI 不能证明真实需求。下一阶段至少要收集行为证据：是否完成第二张图、人工改了多少匹配、哪些缺口促成了真实行动。")
    add("")
    add("## 成功指标与停止条件")
    add("")
    add("北极星：同一用户在首次生成后 14 天内，为第二个真实方向生成并使用另一张工作流地图。原型期可先用代理指标：")
    add("")
    add("- 3 个本机生态扫描成功率 ≥ 95%，且不执行任何 Skill 内容。")
    add("- 前 3 个候选中出现可接受匹配的节点比例 ≥ 80%；每个接受/否决都有可解释理由。")
    add("- 70% 以上关键节点的覆盖状态可由用户在 10 分钟内确认。")
    add("- 至少 3 个不同真实方向中，有 2 个让使用者认为地图改变了下一步行动。")
    add("")
    add("停止或转为上游插件的条件：")
    add("")
    add("- 目标用户只需要目录搜索/去重，专家流程与缺口视图没有改变决策。")
    add("- 候选匹配长期依赖用户逐项重做，无法优于文件搜索。")
    add("- skill-map.ai、SkillNet 或平台原生能力在原型期补齐同一闭环，且本项目没有独有流程资产或用户分发。")
    add("- 用户不会生成第二张真实地图，说明它更像一次性审计报告而非产品。")
    add("")
    add("## 本机只读可行性快照")
    add("")
    add("在当前电脑可访问的 `.agents`、`.codex`、`.claude`、`.cursor` 根上做了一次探索性只读解析：共观察到 276 个可达 `SKILL.md` 路径、263 个唯一内容、6 组跨生态相同内容和 13 组同名不同内容，另有 10 个缺少 `name` 的文件。这个单机样本不代表市场比例，且计数会受软链接、插件缓存和遍历策略影响；它只证明统一实例层必须先定义真实路径、逻辑来源、作用域和内容身份，不能按名称粗暴合并。")
    add("")
    add("## 方法与证据边界")
    add("")
    add(f"本报告按已确认大纲研究 {len(ordered_results)} 个对象，汇总 {len(source_urls)} 个去重来源链接。技术结论优先使用规范、官方文档、官方仓库和论文；痛点使用第一人称 issue/discussion/post，并避免把营销转述重复计数。所有资料截止 {outline['current_date']}。")
    add("")
    add("主要限制：")
    add("")
    add("- 尚未访谈 8–10 位目标用户，不能推断付费意愿或长期留存。")
    add("- GitHub star、下载量和公开 Skill 数量不是独立活跃用户数。")
    add("- 2026 年论文很多仍是预印本或小型 benchmark，精确指标不应跨模型和真实环境外推。")
    add("- 中国 Agent 产品的公开文档可能不完整；文件路径和兼容边界需在真实安装环境复核。")
    add("- 竞品演进极快，正式开发前应再次核查 skill-map.ai 与 SkillNet 的路线图。")
    add("")
    add("# 研究对象目录")
    add("")
    add("目录摘要字段由本轮自主选择为“分类 + 证据强度”，便于先判断对象类型与结论可靠度。")
    add("")
    for index, (outline_item, result, _) in enumerate(ordered_results, start=1):
        name = result.get("name", outline_item["name"])
        category = result.get("category", outline_item["category"])
        evidence = result.get("evidence_strength", "未单列")
        add(f"{index}. [{name}](#item-{outline_item['id']}) — {text_value(category)} | 证据：{text_value(evidence)}")
    add("")
    add("# 分对象研究明细")
    add("")

    for index, (outline_item, result, result_path) in enumerate(ordered_results, start=1):
        add(f"<a id=\"item-{outline_item['id']}\"></a>")
        add("")
        add(f"## {index}. {result.get('name', outline_item['name'])}")
        add("")
        add(f"- 大纲分类：`{outline_item['category']}`")
        add(f"- 研究文件：`results/{result_path.name}`")
        if result.get("evidence_strength"):
            add(f"- 证据强度：{text_value(result['evidence_strength'])}")
        if result.get("confidence"):
            add(f"- 结论置信度：{text_value(result['confidence'])}")
        add("")

        uncertain = [str(item) for item in result.get("uncertain", [])]
        omitted_fields = uncertainty_fields(uncertain, field_names)
        for group in field_groups:
            group_fields = [
                field
                for field in group.get("fields", [])
                if field["name"] not in omitted_fields
                and "[不确定]" not in text_value(
                    get_field(
                        result,
                        field["name"],
                        group.get("category", ""),
                        group.get("description", ""),
                    )
                )
            ]
            if not group_fields:
                continue
            category = group.get("category", "")
            add(f"### {CATEGORY_TITLES.get(category, group.get('description', category))}")
            add("")
            for field in group_fields:
                raw_value = get_field(
                    result,
                    field["name"],
                    group.get("category", ""),
                    group.get("description", ""),
                )
                value = markdown_value(raw_value)
                if not text_value(raw_value):
                    continue
                add(f"**{field['description']}**")
                add("")
                add(value)
                add("")

        nested_category_keys = {
            alias
            for aliases in CATEGORY_ALIASES.values()
            for alias in aliases
        } | {group.get("description", "") for group in field_groups}
        extra_keys = [
            key
            for key in result
            if key not in field_names
            and key not in {"_source_file", "uncertain", "sources"}
            and key not in nested_category_keys
        ]
        if extra_keys:
            add("### 其他信息")
            add("")
            for key in extra_keys:
                value = markdown_value(result[key])
                if not value or "[不确定]" in text_value(result[key]):
                    continue
                add(f"**{key}**")
                add("")
                add(value)
                add("")

        if uncertain:
            add("### 尚未确认")
            add("")
            for entry in uncertain:
                add(f"- {entry}")
            add("")

        sources = [url for url in result.get("sources", []) if isinstance(url, str)]
        if sources:
            add("### 该对象的一手与主要来源")
            add("")
            for url in sources:
                if url.startswith(("http://", "https://")):
                    add(f"- [{source_label(url)}]({url})")
                else:
                    add(f"- {url}")
            add("")

    add("# 全部来源索引")
    add("")
    for url in source_urls:
        add(f"- [{source_label(url)}]({url})")
    add("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"已生成 {REPORT_PATH}：{len(ordered_results)} 个对象，{len(source_urls)} 个去重来源。")


if __name__ == "__main__":
    main()
