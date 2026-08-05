#!/usr/bin/env python3

import html
import io
import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    CondPageBreak,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#14233B")
BLUE = colors.HexColor("#4263D8")
BLUE_LIGHT = colors.HexColor("#EEF2FF")
INK_MUTED = colors.HexColor("#56637A")
LINE = colors.HexColor("#D9E0EC")
PAPER = colors.HexColor("#F7F9FC")
RED = colors.HexColor("#CC5C55")
RED_LIGHT = colors.HexColor("#FDF0EE")
GREEN = colors.HexColor("#27866E")
WHITE = colors.white
FONT = "AtlasCJK"


def register_cjk_font():
    candidates = [
        os.environ.get("CAPABILITY_ATLAS_PDF_FONT"),
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    failures = []
    for candidate in candidates:
        if not candidate or not os.path.isfile(candidate):
            continue
        try:
            pdfmetrics.registerFont(TTFont(FONT, candidate, subfontIndex=0))
            pdfmetrics.registerFontFamily(
                FONT,
                normal=FONT,
                bold=FONT,
                italic=FONT,
                boldItalic=FONT,
            )
            return candidate
        except Exception as error:
            failures.append(f"{candidate}: {error}")
    detail = failures[-1] if failures else "no supported CJK font found"
    raise RuntimeError(f"pdf-font-unavailable:{detail}")


def clean(value):
    text = str(value or "")
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"):
        text = text.replace(dash, "-")
    return text.strip()


def escaped(value):
    return html.escape(clean(value)).replace("\n", "<br/>")


def list_value(values, fallback="未指定"):
    items = [clean(item) for item in (values or []) if clean(item)]
    return "、".join(items) if items else fallback


def verification_label(value):
    return {
        "agent-generated": "Agent 生成",
        "maintainer-reviewed": "维护者已审",
        "sample-run": "样例已跑通",
        "novice-validated": "初级开发者已验证",
    }.get(value, clean(value))


def mode_label(value):
    return "Loop Engineering" if value == "loop" else "Vibe Coding"


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "cover_eyebrow": ParagraphStyle(
            "CoverEyebrow", parent=base["Normal"], fontName=FONT, fontSize=9,
            leading=13, textColor=BLUE, alignment=TA_CENTER, spaceAfter=7,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle", parent=base["Title"], fontName=FONT, fontSize=25,
            leading=35, textColor=NAVY, alignment=TA_CENTER, spaceAfter=12,
            wordWrap="CJK",
        ),
        "cover_summary": ParagraphStyle(
            "CoverSummary", parent=base["Normal"], fontName=FONT, fontSize=11,
            leading=19, textColor=INK_MUTED, alignment=TA_CENTER, leftIndent=18 * mm,
            rightIndent=18 * mm, spaceAfter=18, wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName=FONT, fontSize=20,
            leading=28, textColor=NAVY, spaceBefore=0, spaceAfter=12, wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName=FONT, fontSize=15,
            leading=22, textColor=NAVY, spaceBefore=8, spaceAfter=8, keepWithNext=True,
            wordWrap="CJK",
        ),
        "h3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName=FONT, fontSize=11,
            leading=17, textColor=BLUE, spaceBefore=8, spaceAfter=5, keepWithNext=True,
            wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName=FONT, fontSize=9.3,
            leading=15.2, textColor=NAVY, spaceAfter=5, wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "Small", parent=base["BodyText"], fontName=FONT, fontSize=7.8,
            leading=12, textColor=INK_MUTED, wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"], fontName=FONT, fontSize=9,
            leading=14.5, textColor=NAVY, leftIndent=5 * mm, firstLineIndent=-4 * mm,
            spaceAfter=3, wordWrap="CJK",
        ),
        "callout": ParagraphStyle(
            "Callout", parent=base["BodyText"], fontName=FONT, fontSize=9,
            leading=15, textColor=NAVY, backColor=BLUE_LIGHT, borderColor=LINE,
            borderWidth=0.6, borderPadding=8, borderRadius=4, spaceBefore=3,
            spaceAfter=8, wordWrap="CJK",
        ),
        "warning": ParagraphStyle(
            "Warning", parent=base["BodyText"], fontName=FONT, fontSize=9,
            leading=15, textColor=RED, backColor=RED_LIGHT, borderColor=colors.HexColor("#F0C2BE"),
            borderWidth=0.6, borderPadding=8, borderRadius=4, spaceBefore=3,
            spaceAfter=8, wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "Code", parent=base["BodyText"], fontName=FONT, fontSize=8.2,
            leading=13, textColor=NAVY, backColor=PAPER, borderColor=LINE,
            borderWidth=0.6, borderPadding=8, borderRadius=3, spaceBefore=3,
            spaceAfter=7, wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "Table", parent=base["BodyText"], fontName=FONT, fontSize=7.7,
            leading=11.5, textColor=NAVY, wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "TableHead", parent=base["BodyText"], fontName=FONT, fontSize=7.7,
            leading=11.5, textColor=WHITE, wordWrap="CJK",
        ),
        "stage_number": ParagraphStyle(
            "StageNumber", parent=base["Normal"], fontName=FONT, fontSize=24,
            leading=28, textColor=RED, alignment=TA_CENTER,
        ),
        "stage_label": ParagraphStyle(
            "StageLabel", parent=base["Normal"], fontName=FONT, fontSize=7.5,
            leading=11, textColor=RED, spaceAfter=2,
        ),
        "stage_title": ParagraphStyle(
            "StageTitle", parent=base["Heading1"], fontName=FONT, fontSize=18,
            leading=25, textColor=NAVY, wordWrap="CJK",
        ),
    }
    return styles


def paragraph(value, style):
    return Paragraph(escaped(value) or "未指定", style)


def rich_paragraph(value, style):
    return Paragraph(value, style)


def bullet_list(items, styles, fallback="待补充", ordered=False):
    values = [clean(item) for item in (items or []) if clean(item)] or [fallback]
    flowables = []
    for index, item in enumerate(values, 1):
        marker = f"{index}." if ordered else "-"
        flowables.append(rich_paragraph(f"{marker} {escaped(item)}", styles["bullet"]))
    return flowables


def metadata_table(rows, styles, widths=(42 * mm, 116 * mm)):
    data = [[paragraph(label, styles["small"]), paragraph(value, styles["body"])] for label, value in rows]
    table = Table(data, colWidths=list(widths), hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), PAPER),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def failure_table(items, styles):
    rows = [[
        rich_paragraph("现象", styles["table_head"]),
        rich_paragraph("常见原因", styles["table_head"]),
        rich_paragraph("恢复动作", styles["table_head"]),
    ]]
    failures = items or [{"symptom": "待补充", "likelyCause": "待判断", "recovery": "返回本步骤重新核对前提与验收标准。"}]
    for item in failures:
        rows.append([
            paragraph(item.get("symptom"), styles["table"]),
            paragraph(item.get("likelyCause") or "待判断", styles["table"]),
            paragraph(item.get("recovery"), styles["table"]),
        ])
    table = Table(rows, colWidths=[40 * mm, 42 * mm, 76 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def skill_flowables(step, styles):
    bindings = step.get("skillBindings") or []
    if not bindings:
        return [paragraph("待进行步骤级 Skill 匹配；当前步骤仍可按人工回退路径完成。", styles["callout"])]
    flowables = []
    for binding in bindings:
        role = "主 Skill" if binding.get("role") == "primary" else "备选 Skill"
        parts = [f"<b>{escaped(role)}：{escaped(binding.get('name'))}</b>（{escaped(binding.get('readiness'))}）"]
        if binding.get("rationale"):
            parts.append(f"依据：{escaped(binding.get('rationale'))}")
        if binding.get("invocationPrompt"):
            parts.append(f"调用提示：{escaped(binding.get('invocationPrompt'))}")
        if binding.get("humanFallback"):
            parts.append(f"人工回退：{escaped(binding.get('humanFallback'))}")
        flowables.append(rich_paragraph("<br/>".join(parts), styles["callout"]))
    for gap in step.get("skillGaps") or []:
        candidates = "、".join(
            f"{clean(item.get('name'))}（{clean(item.get('status'))}）"
            for item in gap.get("externalCandidates") or []
        )
        detail = f"能力缺口：{escaped(gap.get('label'))}"
        if candidates:
            detail += f"<br/>外部候选：{escaped(candidates)}"
        detail += f"<br/>人工回退：{escaped(gap.get('humanFallback'))}"
        flowables.append(rich_paragraph(detail, styles["warning"]))
    return flowables


def render_step(step, styles):
    flowables = [
        CondPageBreak(58 * mm),
        rich_paragraph(f"步骤 {int(step.get('order') or 0):02d}", styles["stage_label"]),
        paragraph(step.get("title"), styles["h2"]),
        rich_paragraph(f"<b>目标：</b>{escaped(step.get('objective'))}", styles["body"]),
        rich_paragraph("开始前", styles["h3"]),
        *bullet_list(step.get("prerequisites"), styles),
        rich_paragraph("操作", styles["h3"]),
        *bullet_list(step.get("actions"), styles, ordered=True),
        rich_paragraph("可复制提示词", styles["h3"]),
        paragraph((step.get("prompt") or {}).get("text"), styles["code"]),
    ]
    commands = step.get("commands") or []
    if commands:
        flowables.extend([
            rich_paragraph("人工执行命令", styles["h3"]),
            paragraph("Capability Atlas 不会执行以下命令。复制前请检查项目环境和影响范围。", styles["warning"]),
            paragraph("\n".join(commands), styles["code"]),
        ])
    flowables.extend([
        rich_paragraph("预期产出", styles["h3"]),
        *bullet_list(step.get("expectedOutputs"), styles),
        rich_paragraph("验收标准", styles["h3"]),
        *bullet_list(step.get("acceptanceCriteria"), styles),
        rich_paragraph("失败与恢复", styles["h3"]),
        failure_table(step.get("failureModes"), styles),
        Spacer(1, 3 * mm),
        rich_paragraph("所需证据", styles["h3"]),
        *bullet_list(step.get("evidenceRequirements"), styles),
        rich_paragraph("Skill", styles["h3"]),
        *skill_flowables(step, styles),
    ])
    execution = step.get("execution") or {}
    flowables.append(rich_paragraph(
        f"执行策略：仅人工执行；自动执行：禁止；批准策略：{escaped(execution.get('approvalPolicy'))}。",
        styles["small"],
    ))
    flowables.append(Spacer(1, 5 * mm))
    return flowables


def stage_header(stage, styles):
    applicability = "必需"
    if stage.get("applicability") == "not-applicable":
        applicability = f"不适用（{clean(stage.get('applicabilityReason'))}）"
    number = rich_paragraph(f"{int(stage.get('order') or 0):02d}", styles["stage_number"])
    title = [
        rich_paragraph(f"阶段 {int(stage.get('order') or 0)} · {escaped(stage.get('phase'))}", styles["stage_label"]),
        paragraph(stage.get("title"), styles["stage_title"]),
    ]
    table = Table([[number, title]], colWidths=[26 * mm, 132 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), RED_LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.8, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return [
        table,
        Spacer(1, 4 * mm),
        metadata_table([
            ("工程模式", mode_label(stage.get("mode"))),
            ("适用性", applicability),
            ("质量门", "硬门" if (stage.get("qualityGate") or {}).get("level") == "hard" else "软门"),
        ], styles),
        Spacer(1, 4 * mm),
        paragraph(stage.get("summary"), styles["body"]),
        rich_paragraph(f"<b>最低判断：</b>{escaped(stage.get('minimumAssessment'))}", styles["callout"]),
        rich_paragraph("阶段质量门", styles["h2"]),
        *bullet_list((stage.get("qualityGate") or {}).get("criteria"), styles),
    ]


def render_document(payload):
    playbook = payload.get("playbook") or {}
    brief = payload.get("projectBrief") or {}
    verification = payload.get("verification") or {}
    styles = build_styles()
    output = io.BytesIO()
    title = clean(playbook.get("title")) or "从 0 到 1 开发手册"
    content_hash = clean(playbook.get("contentHash"))
    status = "已确认 v{}".format(playbook.get("confirmedVersion")) if playbook.get("status") == "confirmed" else "草案 r{}".format(playbook.get("revision"))
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="Capability Atlas",
        subject=f"Development Playbook {content_hash}",
        pageCompression=1,
    )

    story = [
        Spacer(1, 34 * mm),
        rich_paragraph("CAPABILITY ATLAS · DEVELOPMENT PLAYBOOK", styles["cover_eyebrow"]),
        paragraph(title, styles["cover_title"]),
        paragraph(playbook.get("summary"), styles["cover_summary"]),
        metadata_table([
            ("版本状态", status),
            ("验证等级", verification_label(playbook.get("verificationLevel"))),
            ("交付目标", playbook.get("deliveryTarget")),
            ("Project Brief", f"{(playbook.get('source') or {}).get('projectBriefId')}@{(playbook.get('source') or {}).get('projectBriefVersion')}"),
            ("模板", f"{(playbook.get('source') or {}).get('templateId')}@{(playbook.get('source') or {}).get('templateVersion')}"),
            ("内容哈希", content_hash),
        ], styles),
        Spacer(1, 10 * mm),
        paragraph("本手册只提供步骤、提示词、命令建议和验收门；Capability Atlas 不会自动运行命令或修改项目。", styles["callout"]),
        PageBreak(),
        rich_paragraph("冻结的 Project Brief", styles["h1"]),
        metadata_table([
            ("项目", brief.get("projectName")),
            ("问题", brief.get("problemStatement")),
            ("目标用户", list_value(brief.get("targetUsers"))),
            ("首要结果", brief.get("primaryOutcome")),
            ("首版范围", list_value(brief.get("inScope"))),
            ("明确非目标", list_value(brief.get("outOfScope"))),
            ("约束", list_value(brief.get("constraints"), "无额外约束")),
            ("成功标准", list_value(brief.get("successCriteria"))),
            ("目标平台", list_value(brief.get("targetPlatforms"))),
            ("黄金路径技术栈", list_value(playbook.get("goldenStack"))),
        ], styles),
        Spacer(1, 8 * mm),
        rich_paragraph("使用方式", styles["h1"]),
        *bullet_list([
            "前四阶段采用 Vibe Coding 快速探索，但必须记录假设与取舍。",
            "后五阶段采用 Loop Engineering，按实现-验证-反馈-修正闭环推进。",
            "软门允许带着已标注假设前进；硬门必须保存证据后才能继续。",
            "阶段不能删除；确实不适用时，必须保留最低判断并填写原因。",
        ], styles, ordered=True),
    ]

    for stage in playbook.get("stages") or []:
        story.append(PageBreak())
        story.extend(stage_header(stage, styles))
        gate = stage.get("qualityGate") or {}
        if gate.get("requiredEvidence"):
            story.extend([
                rich_paragraph("硬门证据", styles["h3"]),
                *bullet_list(gate.get("requiredEvidence"), styles),
            ])
        else:
            story.append(paragraph("软门允许带着已明确标注的假设进入下一阶段。", styles["callout"]))
        if stage.get("applicability") == "not-applicable":
            story.append(paragraph("本阶段已标记为不适用，保留最低判断与原因，不生成执行步骤。", styles["warning"]))
        else:
            for step in stage.get("steps") or []:
                story.extend(render_step(step, styles))

    story.extend([
        PageBreak(),
        rich_paragraph("验证等级说明", styles["h1"]),
        *bullet_list([
            "Agent 生成：结构与字段通过系统校验，但内容尚未人工确认。",
            "维护者已审：维护者已检查草案与变更差异。",
            "样例已跑通：至少一个标准样例按手册完成。",
            "初级开发者已验证：目标用户可在有限协助下完成项目。",
        ], styles),
        Spacer(1, 8 * mm),
        rich_paragraph("当前内容验证记录", styles["h2"]),
    ])
    records = verification.get("records") or []
    if not records:
        story.append(paragraph("尚无样例跑通或初级开发者验证记录。", styles["callout"]))
    for record in records:
        subject = record.get("sampleName") or record.get("testerProfile")
        detail = [
            f"<b>{escaped(verification_label(record.get('level')))}</b>",
            f"验证对象：{escaped(subject)}",
            f"结论：{escaped(record.get('summary'))}",
            f"证据：{escaped('；'.join((item.get('label') or item.get('kind') or '证据') + '：' + clean(item.get('value')) for item in record.get('evidence') or []))}",
        ]
        if record.get("environment"):
            detail.insert(2, f"环境：{escaped(record.get('environment'))}")
        if record.get("assistanceLevel"):
            detail.insert(2, f"协助程度：{escaped(record.get('assistanceLevel'))}")
        story.append(rich_paragraph("<br/>".join(detail), styles["callout"]))
    story.append(paragraph(f"可追溯内容哈希：{content_hash}", styles["callout"]))

    def page_frame(canvas, doc):
        canvas.saveState()
        width, height = A4
        if doc.page > 1:
            canvas.setStrokeColor(LINE)
            canvas.setLineWidth(0.5)
            canvas.line(22 * mm, height - 13 * mm, width - 22 * mm, height - 13 * mm)
            canvas.setFont(FONT, 7.2)
            canvas.setFillColor(INK_MUTED)
            canvas.drawString(22 * mm, height - 10 * mm, clean(title)[:48])
            canvas.drawRightString(width - 22 * mm, height - 10 * mm, f"HASH {content_hash[:12]}")
        canvas.setStrokeColor(LINE)
        canvas.line(22 * mm, 13 * mm, width - 22 * mm, 13 * mm)
        canvas.setFont(FONT, 7.2)
        canvas.setFillColor(INK_MUTED)
        canvas.drawString(22 * mm, 9 * mm, f"Capability Atlas · {status}")
        canvas.drawRightString(width - 22 * mm, 9 * mm, f"{doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    return output.getvalue()


def main():
    register_cjk_font()
    payload = json.load(sys.stdin)
    result = render_document(payload)
    sys.stdout.buffer.write(result)


if __name__ == "__main__":
    main()
