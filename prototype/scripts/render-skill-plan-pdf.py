#!/usr/bin/env python3

import html
import io
import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

INK = colors.HexColor("#14233B")
BLUE = colors.HexColor("#4263D8")
BLUE_LIGHT = colors.HexColor("#EEF2FF")
MUTED = colors.HexColor("#56637A")
LINE = colors.HexColor("#D9E0EC")
RED = colors.HexColor("#B74C46")
RED_LIGHT = colors.HexColor("#FDF0EE")
FONT = "SkillMeshCJK"


def register_font():
    candidates = [
        os.environ.get("CAPABILITY_ATLAS_PDF_FONT"),
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ]
    failures = []
    for candidate in candidates:
        if not candidate or not os.path.isfile(candidate):
            continue
        try:
            pdfmetrics.registerFont(TTFont(FONT, candidate, subfontIndex=0))
            pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT, italic=FONT, boldItalic=FONT)
            return
        except Exception as error:
            failures.append(f"{candidate}: {error}")
    raise RuntimeError(f"pdf-font-unavailable:{failures[-1] if failures else 'no supported CJK font found'}")


def esc(value):
    text = str(value or "").strip()
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"):
        text = text.replace(dash, "-")
    return html.escape(text).replace("\n", "<br/>")


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("Title", parent=base["Title"], fontName=FONT, fontSize=24, leading=32, textColor=INK, spaceAfter=10),
        "summary": ParagraphStyle("Summary", parent=base["BodyText"], fontName=FONT, fontSize=10, leading=17, textColor=MUTED, spaceAfter=16),
        "stage": ParagraphStyle("Stage", parent=base["Heading2"], fontName=FONT, fontSize=14, leading=21, textColor=INK, spaceBefore=10, spaceAfter=8),
        "step": ParagraphStyle("Step", parent=base["Heading3"], fontName=FONT, fontSize=11, leading=17, textColor=BLUE, spaceAfter=5),
        "body": ParagraphStyle("Body", parent=base["BodyText"], fontName=FONT, fontSize=9, leading=15, textColor=INK, spaceAfter=4),
        "small": ParagraphStyle("Small", parent=base["BodyText"], fontName=FONT, fontSize=8, leading=13, textColor=MUTED, spaceAfter=3),
        "card": ParagraphStyle("Card", parent=base["BodyText"], fontName=FONT, fontSize=9, leading=15, textColor=INK, backColor=BLUE_LIGHT, borderColor=LINE, borderWidth=0.6, borderPadding=8, borderRadius=4, spaceAfter=7),
        "gap": ParagraphStyle("Gap", parent=base["BodyText"], fontName=FONT, fontSize=8.5, leading=14, textColor=RED, backColor=RED_LIGHT, borderColor=colors.HexColor("#F0C2BE"), borderWidth=0.6, borderPadding=7, borderRadius=4, spaceAfter=5),
    }


def paragraph(value, style):
    return Paragraph(esc(value) or "未指定", style)


def bullet(value, style):
    return Paragraph(f"- {esc(value)}", style)


def availability_label(value):
    return {
        "ready": "目标端已就绪",
        "other-agent": "其他 Agent 可同步",
        "pending": "证据待确认",
        "ecosystem": "生态补充安装",
    }.get(value, value or "能力缺口")


def render(plan):
    register_font()
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    style = styles()
    depth = {"quick": "精简", "standard": "标准", "full": "完整"}.get(plan.get("planningDepth"), plan.get("planningDepth"))
    counts = plan.get("summaryCounts") or {}
    targets = plan.get("mappingScope", {}).get("targetAgents") or []
    target_plans = plan.get("targetPlans") or [{
        "targetAgent": targets[0] if targets else {"id": "current", "label": "当前 Agent", "detected": True},
        "summaryCounts": counts,
        "capabilityAvailability": [],
        "gaps": plan.get("gaps") or [],
        "stages": plan.get("stages") or [],
    }]
    story = [
        paragraph(plan.get("title"), style["title"]),
        paragraph(plan.get("summary"), style["summary"]),
        paragraph(f"测绘目标：{' / '.join(target.get('label', target.get('id', '')) for target in targets) or '当前 Agent'}", style["small"]),
        paragraph(f"自动深度：{depth}　目标端已就绪：{counts.get('readyCapabilityCount', 0)}　其他 Agent：{counts.get('otherAgentCount', 0)}　待确认：{counts.get('pendingCount', 0)}　生态补充：{counts.get('ecosystemGapCount', 0)}", style["small"]),
        paragraph(f"内容哈希：{plan.get('contentHash', '')}", style["small"]),
        Spacer(1, 5 * mm),
    ]
    for target_plan in target_plans:
        target = target_plan.get("targetAgent") or {}
        target_counts = target_plan.get("summaryCounts") or {}
        story.append(paragraph(f"{target.get('label', target.get('id', '目标 Agent'))} 测绘结果", style["stage"]))
        story.append(paragraph(
            f"应用目录：{'已检测' if target.get('detected') else '未检测'}　必需能力：{target_counts.get('requiredCapabilityCount', 0)}　已就绪：{target_counts.get('readyCapabilityCount', 0)}　可同步：{target_counts.get('otherAgentCount', 0)}　待确认：{target_counts.get('pendingCount', 0)}　生态补充：{target_counts.get('ecosystemGapCount', 0)}",
            style["small"],
        ))
        story.append(paragraph("Agent 能力归属", style["step"]))
        availability = target_plan.get("capabilityAvailability") or []
        for status in ("ready", "other-agent", "pending", "ecosystem"):
            matches = [item for item in availability if item.get("status") == status]
            story.append(paragraph(f"{availability_label(status)} · {len(matches)}", style["body"]))
            for item in matches:
                candidates = "、".join(candidate.get("name", "") for candidate in item.get("candidates") or [] if candidate.get("name"))
                detail = f"{item.get('label')} · {item.get('stageTitle')}"
                if candidates:
                    detail += f"；{candidates}"
                story.append(bullet(detail, style["small"]))
        gaps = target_plan.get("gaps") or []
        story.append(paragraph("能力缺口", style["step"]))
        if gaps:
            for gap in gaps:
                candidates = "、".join(item.get("name", "") for item in gap.get("candidates") or [] if item.get("name"))
                detail = f"{gap.get('label')} · {gap.get('stepTitle')}（{availability_label(gap.get('availability') or gap.get('status'))}）"
                if candidates:
                    detail += f"；候选：{candidates}"
                story.append(paragraph(detail, style["gap"]))
        else:
            story.append(paragraph("当前目标没有能力缺口。", style["body"]))
        story.append(paragraph("Skill 路线", style["step"]))
        for stage in target_plan.get("stages") or []:
            if not stage.get("cards"):
                continue
            story.append(paragraph(f"{int(stage.get('order') or 0):02d} · {stage.get('title')}", style["stage"]))
            for card in stage.get("cards") or []:
                primary = card.get("primary") or {}
                card_lines = [
                    Paragraph(f"<b>{int(card.get('order') or 0):02d} · {esc(card.get('stepTitle'))}</b>", style["step"]),
                    paragraph(card.get("objective"), style["body"]),
                    Paragraph(f"<b>主 Skill：{esc(primary.get('name'))}</b>（已确认；{esc(primary.get('readiness'))}）<br/>负责：{esc('、'.join(primary.get('responsibilities') or []))}<br/>调用方式：{esc(primary.get('invocationPrompt'))}", style["card"]),
                ]
                if card.get("supportingSkills"):
                    card_lines.append(paragraph("已确认协作 Skill：" + "、".join(item.get("name", "") for item in card.get("supportingSkills") or []), style["small"]))
                if card.get("alternatives"):
                    card_lines.append(paragraph("待确认备选：" + "、".join(item.get("name", "") for item in card.get("alternatives") or []), style["small"]))
                card_lines.append(paragraph("使用到什么程度", style["step"]))
                card_lines.extend(bullet(item, style["body"]) for item in card.get("completionCriteria") or [])
                story.append(KeepTogether(card_lines))
                story.append(Spacer(1, 3 * mm))
        if not any(stage.get("cards") for stage in target_plan.get("stages") or []):
            story.append(paragraph("当前目标没有达到可信门槛的主 Skill。", style["gap"]))
        story.append(Spacer(1, 4 * mm))
    story.append(Spacer(1, 5 * mm))
    story.append(paragraph("Skill 推荐来自本机扫描、文本证据与人工映射，不代表已经运行验证。", style["small"]))
    document.build(story)
    return output.getvalue()


def main():
    try:
        plan = json.loads(sys.stdin.read())
        sys.stdout.buffer.write(render(plan))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
