export function candidateActionLabels(name, decision = "unreviewed", provider = "", scope = "") {
  const candidateName = String(name || "当前 Skill").trim() || "当前 Skill";
  const source = [provider, scope].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
  const candidateLabel = source ? `${candidateName}（${source}）` : candidateName;
  return {
    inspect: `查看 ${candidateLabel} 详情`,
    copy: `复制 ${candidateLabel} 路径`,
    confirm: decision === "confirmed"
      ? `取消确认 ${candidateLabel}`
      : `确认 ${candidateLabel} 匹配`,
    partial: decision === "partial"
      ? `取消 ${candidateLabel} 的部分覆盖标记`
      : `标记 ${candidateLabel} 为部分覆盖`,
    exclude: `排除 ${candidateLabel} 候选`,
    install: decision === "confirmed"
      ? `将 ${candidateLabel} 加入安装计划`
      : `确认 ${candidateLabel} 后可加入安装计划`,
  };
}
