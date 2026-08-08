---
name: Capability Atlas
description: 本机 Agent Skill 能力映射与证据审阅工作台
colors:
  primary: "#3A5CCC"
  primary-deep: "#27449F"
  primary-wash: "#E9EDFF"
  neutral-bg: "#F3F6FA"
  surface: "#FFFFFF"
  surface-soft: "#FBFCFE"
  ink: "#132238"
  muted: "#607086"
  line: "#D9E1EB"
  line-strong: "#B9C6D5"
  success: "#1F6F5F"
  success-wash: "#E5F3EF"
  warning: "#8A5900"
  warning-wash: "#FFF3D8"
  uncertain: "#655092"
  uncertain-wash: "#EEEAFD"
  danger: "#A5413C"
  danger-wash: "#FAE8E6"
  code-bg: "#152238"
  code-text: "#E7ECF4"
  code-muted: "#AAB6C8"
  code-line: "#7A8AA2"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "28px"
    fontWeight: 720
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.4
  mono:
    fontFamily: "SFMono-Regular, Cascadia Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  xs: "2px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "40px"
  status-chip:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
---

# Design System: Capability Atlas

## Overview

**Creative North Star: "证据测绘桌"**

Capability Atlas 应像一张被反复使用的证据测绘桌：用户先看到当前工作流、覆盖结论和下一步动作，需要时再打开来源、路径与详细判断。界面以清楚的分隔、稳定的布局和熟悉的控件建立信任，而不是用装饰制造“智能感”。

设计采用克制的产品 UI register。已有工作流时，工作台占据全部注意力；无工作流时，空状态承担简短介绍和行动指引。颜色只承担选择、状态、焦点与主操作，信息密度通过分组和渐进披露管理。

**Key Characteristics:**

- 固定视口的任务工作台，而非不断增长的营销页面。
- 单一系统无衬线字体与清楚的固定字号层级。
- 平面优先，边界和色调层级优先于阴影。
- 证据详情按需展开，所有可信状态始终有文字说明。

## Colors

色板以冷静中性色为主体，标定蓝只用于主操作、选中和焦点；成功、警告、不确定和危险颜色只表达真实状态。

**The Ten Percent Rule.** 主色在任何一个视口中的面积不得超过约 10%，不得作为装饰背景大面积铺陈。

**The Semantic Ink Rule.** 小字号状态文字必须使用通过 AA 对比度的深色语义色，浅色 wash 只作为背景，不能替代文字标签。

## Typography

**Display Font:** System UI sans-serif stack
**Body Font:** System UI sans-serif stack
**Label/Mono Font:** SFMono-compatible stack，仅用于路径、哈希、版本和代码

**Character:** 字体应安静、熟悉、适合长时间工作的本机工具。标题通过字重和间距建立层级，不使用压缩展示字体或装饰性全大写。

### Hierarchy

- **Display:** 页面级标题，固定 28px，最多正常换两行。
- **Headline:** 区域标题，固定 20px。
- **Title:** 列表与详情标题，16px–18px。
- **Body:** 正文 14px，长说明限制在 65–75ch。
- **Label:** 控件和元数据 12px，不使用宽字距全大写。

**The One Family Rule.** 产品界面只使用一套系统无衬线家族；等宽字体不能承担普通标签、按钮或标题。

## Elevation

系统默认平面化，通过背景色调、完整边框和分隔线表达层级。阴影只用于进入顶层的 dialog、popover、toast，以及悬浮状态需要与下层明确脱离的时刻。

**The Flat-at-Rest Rule.** 静止列表行和内容分组不得依赖阴影；如果去掉阴影后层级消失，应先修正结构和间距。

## Components

### Buttons

- **Shape:** 小幅圆角，桌面高度 40px，窄屏触控高度至少 44px。
- **Primary:** 标定蓝底色和白字，仅用于当前最重要动作。
- **Hover / Focus:** 颜色加深或完整焦点环；不使用上浮位移。
- **Secondary:** 白色表面、完整边框和深色文字。

### Chips

- **Style:** 紧凑矩形圆角，始终包含状态文字；状态色只占小面积。
- **State:** 选中、成功、警告、不确定和危险使用独立语义色，不共享含义。

### Cards / Containers

- **Corner Style:** 普通内容使用中等圆角；仅 dialog 使用大圆角。
- **Background:** 页面背景与白色工作表面构成两层，不继续嵌套同形卡片。
- **Shadow Strategy:** 静止内容无阴影，顶层浮层使用单一环境阴影。
- **Border:** 使用完整 1px 边框或分隔线，禁止单侧彩条。
- **Internal Padding:** 以 8px、12px、16px、24px 组成节奏。

### Inputs / Fields

- **Style:** 白色背景、完整边框、统一高度与标签位置。
- **Focus:** 主色边框与清晰外环。
- **Error / Disabled:** 同时使用文字、颜色和禁用状态，不依赖透明度单独表达。

### Navigation

顶部只保留品牌、当前任务和高频动作。平板与手机把次级动作收进标准菜单，证据详情使用原生 dialog，关闭后焦点返回触发项。

### Stage Row

阶段是有真实顺序的紧凑列表。行内展示阶段号、名称、覆盖状态和必要摘要；选中使用完整边框与轻底色，不使用浮起卡片、异形数字块或装饰轨迹线。

## Do's and Don'ts

### Do:

- **Do** 让用户先看到结论、状态和下一步，再按需展开证据。
- **Do** 在宽屏使用三栏工作台，在窄屏使用侧滑或全屏详情。
- **Do** 使用标准按钮、列表、表单、details 和 dialog 行为。
- **Do** 为长名称、动态阶段数和大量候选提供稳定的截断、换行与内部滚动。

### Don't:

- **Don't** 使用“通用 AI SaaS 控制台”的蓝紫渐变、发光网格、玻璃拟态或装饰性等高线。
- **Don't** 使用英文大写眉题、A/B/C 或无业务含义的编号作为章节脚手架。
- **Don't** 把每段内容做成同形圆角卡片，或创建嵌套卡片。
- **Don't** 使用大于 1px 的 `border-left` / `border-right` 作为彩色强调条。
- **Don't** 使用渐变文字、装饰性悬浮动画或压缩展示字体表达“技术感”。
