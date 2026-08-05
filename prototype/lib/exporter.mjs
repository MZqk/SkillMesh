const STATUS_LABELS = {
  complete: "已人工确认",
  partial: "部分",
  uncertain: "不确定",
  missing: "缺失",
};

const CAPABILITY_STATUS_LABELS = {
  confirmed: "已人工确认",
  evidenced: "本机有强证据",
  uncertain: "只有弱证据",
  missing: "需要补齐",
};

export function planToMarkdown(plan) {
  const lines = [
    `# 能力地图：${plan.goal}`,
    "",
    `> 参考流程：${plan.template.name} v${plan.template.version}；生成时间：${plan.generatedAt}`,
    "",
    "## 假设",
    "",
    ...plan.assumptions.map((item) => `- ${item}`),
    "",
    "## 覆盖摘要",
    "",
    `- 已人工确认：${plan.summary.counts.complete}`,
    `- 部分：${plan.summary.counts.partial}`,
    `- 不确定：${plan.summary.counts.uncertain}`,
    `- 缺失：${plan.summary.counts.missing}`,
    `- 综合需求匹配：${Math.round((plan.summary.matchScore || 0) * 100)}%`,
    `- 必需能力覆盖：${Math.round((plan.summary.coverageRatio || 0) * 100)}%`,
    `- 运行就绪证据：${Math.round((plan.summary.readinessScore || 0) * 100)}%`,
    `- 缺失的必需能力：${plan.summary.missingRequiredCapabilities || 0}`,
    "",
    "## 工作流与能力匹配",
    "",
  ];

  for (const stage of plan.stages) {
    lines.push(
      `### ${stage.order}. ${stage.title} · ${STATUS_LABELS[stage.status]}`,
      "",
      stage.description,
      "",
      `- 判断：${stage.reason}`,
      `- 覆盖：${stage.coverage.matched}/${stage.coverage.total}`,
      `- 需求匹配：${Math.round((stage.matchScore || 0) * 100)}%`,
      `- 运行就绪：${Math.round((stage.readinessScore || 0) * 100)}%`,
      `- 元数据与来源质量：${Math.round((stage.qualityScore || 0) * 100)}%`,
      `- 能力：${stage.capabilityCoverage.map((item) => `${item.label}（${CAPABILITY_STATUS_LABELS[item.status]}）`).join("；")}`,
      `- 置信度：${Math.round(stage.confidence * 100)}%`,
      `- 交付物：${stage.deliverables.join("；")}`,
      `- 验收门：${stage.acceptanceGate}`,
      "",
    );
    const gaps = stage.capabilityCoverage.filter((item) => item.status === "missing");
    if (gaps.length) {
      lines.push("缺口与外部候选：", "");
      for (const gap of gaps) {
        lines.push(`- **${gap.label}** · 查询建议：\`${gap.gapQuery || gap.label}\``);
        for (const external of gap.externalCandidates || []) {
          lines.push(`  - 外部候选：${external.packageId || external.skillName || external.sourceUrl} · ${external.status || "suggested"} · 尚未自动安装`);
        }
      }
      lines.push("");
    }
    if (stage.candidates.length) {
      lines.push("候选 Skill：", "");
      for (const candidate of stage.candidates) {
        const evidence = candidate.evidence
          .map((item) => `${item.capability}←${item.term}/${item.field}`)
          .join("；");
        lines.push(
          `- **${candidate.name}** · ${candidate.provider}/${candidate.scope} · 综合 ${Math.round(candidate.score * 100)}%`,
          `  - 分维度：匹配 ${Math.round((candidate.fitScore || 0) * 100)}% / 覆盖 ${Math.round((candidate.coverageScore || 0) * 100)}% / 就绪 ${Math.round((candidate.readinessScore || 0) * 100)}% / 质量 ${Math.round((candidate.qualityScore || 0) * 100)}% / 证据置信 ${Math.round((candidate.confidence || 0) * 100)}%`,
          ...(candidate.path ? [`  - 路径：\`${candidate.path}\``] : []),
          `  - 证据：${evidence || "弱相关，待人工确认"}`,
          `  - 人工状态：${candidate.decision}`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "## 边界",
    "",
    "此报告是只读规划证据，不会安装、执行或修改任何 Skill。文件存在不等于能力已经运行验证。",
    "",
  );
  return lines.join("\n");
}
