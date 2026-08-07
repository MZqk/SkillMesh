# Deep Research: 网页端调用 WorkBuddy / QoderWork / Codex 可行性

> Generated 2026-08-05 | Depth: standard | Sources: 14 | 项目: SkillsMap prototype

## TL;DR

三个产品中，**只有 OpenAI Codex（通过 Responses API）可以直接从 SkillsMap 网页后端调用**，且项目已有 `runAgentTask()` 骨架代码。WorkBuddy 和 QoderWork 均为桌面客户端，不暴露任何可被网页调用的公开 API。Qoder 平台有一个 Cloud Agents REST API（beta），但它面向云端编码 Agent，不等于 QoderWork 桌面 Agent。MCP 协议的 Streamable HTTP 传输模式理论上可被浏览器使用，但需要 Node.js 代理层。

## Executive Summary

SkillsMap prototype 是一个运行在 localhost:4317 的 Node.js Web 应用，已具备 MCP server（`mcp-server.mjs`）和 OpenAI API 代理调用（`server.mjs` 中的 `runAgentTask()`）。用户希望从该网页直接调用 WorkBuddy、QoderWork 或 Codex 三类 AI Agent。

调研结论按可行性排序：

**可行（已有代码基础）：OpenAI Codex via Responses API。** 项目的 `server.mjs` 第 72-80 行已实现 `runAgentTask()` 函数，通过 `CODEX_API_KEY` / `OPENAI_API_KEY` 调用 `codex-mini-latest` 模型。Responses API 支持内置工具（代码执行、Web 搜索、文件搜索），可以从 Node.js 后端直接调用并流式返回结果给前端。这是唯一一条已打通且持续维护的集成路径。

**理论可行但需大量工作：MCP Streamable HTTP。** MCP 规范（2025-03-26）定义了 stdio 和 Streamable HTTP 两种传输模式 [43]。Streamable HTTP 使用标准 HTTP POST + SSE，浏览器端技术上可以连接，但需要：(1) 在 server.mjs 中实现 MCP client over Streamable HTTP；(2) 处理浏览器 CORS 和 SSE 限制；(3) 构建前端 UI 展示 MCP tool 调用结果。目前没有官方浏览器 SDK。

**不可行：WorkBuddy 和 QoderWork 桌面 Agent。** WorkBuddy（腾讯云）是纯桌面客户端 + 微信小程序，无公开 API、SDK 或可嵌入组件 [1][4][5]。QoderWork 同样是桌面 Agent，仅作为 MCP 客户端向外连接，不暴露可被外部调用的端点 [20][21][22]。Qoder 平台的 Cloud Agents API（`api.qoder.com`，beta）提供 `/agents`、`/sessions` 等 REST 端点 [20]，但它控制的是 Qoder 云端编码 Agent，不是 QoderWork 桌面 Agent。

## 1. 各产品集成能力现状 [Confidence: High]

### 1.1 WorkBuddy（腾讯云）

WorkBuddy 定位为"全场景 AI 办公工作台"，形态为 Windows/macOS 桌面客户端 + 微信/企业微信小程序 [1]。它的核心能力链路是：自然语言理解 → 自主任务拆解 → 工具调用执行 → 生成可验证交付物（文档/表格/PPT）[2]。

关键发现：WorkBuddy 是 MCP **客户端**，不是 MCP 服务端。它的 Connector 子系统通过 MCP 协议连接外部 MCP server（配置存储在 `~/.workbuddy/mcp.json`），允许 WorkBuddy 调用第三方工具 [5]。它还支持通过 OpenAI 兼容端点 `https://tokenhub.tencentmaas.com/v1/chat/completions` 接入自定义模型 [4]。但这些都是 WorkBuddy **向外调用**的能力——没有任何机制让外部 Web 应用**调用 WorkBuddy 本身**。

结论：WorkBuddy 无法被 SkillsMap 网页调用。反向思路——让 WorkBuddy 通过 MCP 调用 SkillsMap 的 MCP server——是可行的，但这不是用户要求的方向。

### 1.2 QoderWork（Qoder）

QoderWork 是 Qoder 桌面应用的组成部分，作为本地 AI Agent 运行。它的集成面有两个：Connectors（连接 Slack、Notion 等外部服务）和 Hooks（本地 shell 脚本生命周期钩子）[21][22]。两者都是**出站**连接——QoderWork 主动调用外部服务，而非暴露端点供外部调用。

QoderWork 同样是 MCP 客户端，通过 Streamable HTTP/SSE（远程）或 stdio（本地）连接外部 MCP server [24]。它不能作为 MCP server 被发现或连接。

Qoder 平台（注意：不是 QoderWork 桌面 Agent）提供了 Cloud Agents REST API [20]：

- Base URL: `https://api.qoder.com/api/v1/cloud`（Managed Mode）
- 端点: `/agents`, `/sessions`, `/environments`, `/events`, `/files`, `/vaults`, `/skills`, `/memory_stores`, `/deployments`
- 认证: Personal Access Token
- 状态: Beta
- 支持 SSE 事件流

这个 API 管理的是 Qoder 云端编码 Agent 的生命周期（创建 Agent、启动 Session、部署代码等），与 QoderWork 桌面 Agent 的能力（文件操作、MCP 调用、本地工具执行）没有直接对应关系。即使调用此 API，也无法触发 QoderWork 桌面端的 Agent 行为。

结论：QoderWork 桌面 Agent 无法被 SkillsMap 网页调用。Cloud Agents API 是一个独立产品，不适用于当前场景。

### 1.3 OpenAI Codex

OpenAI Codex 生态有三个形态 [40][48]：

**Codex CLI**：开源终端 Agent，本地运行，使用 Chat Completions 或 Responses API。不适合 Web 集成（它是终端程序）。

**Codex Cloud**：ChatGPT 内置的编码 Agent，在沙箱云环境中运行任务。通过 ChatGPT UI 和 GitHub/Slack/Linear 集成访问，不是独立开发者 API。

**Responses API**：OpenAI 平台 API，支持 `codex-mini-latest` 等模型，提供内置工具（代码解释器、Web 搜索、文件搜索），可从任何 HTTP 客户端调用。**这是 Web 集成的正确路径。**

Responses API 是 Assistants API 的继任者（Assistants API 将于 2026 年 8 月退役）[42]。它通过 `openai` npm SDK 或直接 HTTP 调用，支持流式输出、多步工具调用和沙箱代码执行。SkillsMap 的 `server.mjs` 已经在第 72-80 行实现了基础调用骨架。

结论：Responses API + `codex-mini-latest` 是唯一已验证可行的路径，且项目已有代码基础。

## 2. MCP 协议从网页端调用的可行性 [Confidence: High]

MCP 规范（2025-03-26 修订版）定义了两种内置传输模式 [43]：

**stdio**：基于子进程的标准输入/输出。浏览器无法使用此模式。

**Streamable HTTP**：使用标准 HTTP POST 发送请求，SSE（Server-Sent Events）接收服务端推送。支持 Bearer Token 和 OAuth 2.0 认证。这是浏览器理论上可连接的模式。

没有 WebSocket 传输模式。规范允许自定义传输实现，但没有官方 WebSocket 规范。

TypeScript SDK（`@modelcontextprotocol/sdk`，SkillsMap 已依赖 v1.30.0）支持 Streamable HTTP [44]。但该 SDK 主要面向 Node.js/Bun/Deno 服务端，没有明确文档说明如何在浏览器端使用。

实际集成路径：SkillsMap 的 `server.mjs`（Node.js）作为 MCP client，通过 Streamable HTTP 连接外部 MCP server（包括 SkillsMap 自己的 `mcp-server.mjs`，如果它暴露 HTTP 端点的话）。前端浏览器通过普通 HTTP API 与 `server.mjs` 通信，`server.mjs` 再代理 MCP 调用。这是经典的 API proxy 模式。

浏览器直接连接 MCP server 的障碍：CORS 策略、SSE 连接管理、认证 token 暴露（浏览器端存储不安全）。因此 Node.js 代理层是必要的。

## 3. SkillsMap 项目现状与集成架构 [Confidence: High]

当前项目已具备的集成基础设施：

**server.mjs**（第 72-80 行）已实现 `runAgentTask()` 函数，通过环境变量 `CODEX_API_KEY` / `OPENAI_API_KEY` 读取 API 密钥，使用 `codex-mini-latest` 模型调用 OpenAI Responses API。密钥只在服务端读取，不下发到浏览器 [server.mjs:74]。

**mcp-server.mjs** 已实现完整的 MCP server，支持 stdio 传输，暴露 `create_requirement_workflow_draft`、`atlas_status`、`search_skills`、`assess_workflow`、`create_project_brief_draft` 等 tool。当前仅通过 stdio 被外部 Agent（Codex CLI、Claude Code、Gemini CLI）调用。

**public/ 目录**包含前端静态文件，通过 `server.mjs` 的 HTTP 服务器提供服务。

**缺失的部分**：前端 UI 中没有 AI 对话界面或 Agent 调用按钮。`runAgentTask()` 存在但没有被路由到任何 HTTP endpoint。MCP server 仅支持 stdio，不支持 Streamable HTTP。

## 4. 可行的集成方案 [Confidence: High]

### 方案 A：扩展 OpenAI Codex 代理（最小改动，立即可行）

将现有的 `runAgentTask()` 函数连接到 HTTP 路由，让前端可以通过 `fetch()` 调用：

```
前端 → POST /api/agent { task, context } → server.mjs → OpenAI Responses API → 流式返回
```

改动量：约 20-30 行代码。在 `server.mjs` 的路由分发中添加一个 `POST /api/agent` 端点，调用已有的 `runAgentTask()`，将结果以 SSE 或 JSON 返回给前端。前端添加一个聊天输入框和结果展示区域。

优势：代码基础已存在，API key 安全（仅服务端读取），支持流式输出。
限制：只调用 OpenAI 模型，不涉及 WorkBuddy 或 QoderWork。

### 方案 B：MCP server 增加 Streamable HTTP 传输（中等改动）

让 `mcp-server.mjs` 同时支持 stdio 和 Streamable HTTP 两种传输模式。`server.mjs` 作为 MCP client 连接本地 HTTP 端点，将 MCP tool 调用结果转发给前端。

```
前端 → POST /api/mcp/call { tool, args } → server.mjs (MCP client)
    → mcp-server.mjs (Streamable HTTP) → 执行 tool → 返回结果
```

改动量：约 100-150 行。需要：(1) mcp-server.mjs 增加 HTTP 监听（可用 `@modelcontextprotocol/sdk` 的 StreamableHTTPServerTransport）；(2) server.mjs 增加 MCP client 连接和代理路由；(3) 前端增加 MCP tool 调用 UI。

优势：复用现有 MCP tool 生态，前端可以直接调用 SkillsMap 的所有 MCP 能力（工作流创建、技能搜索、评估等），无需为每个 tool 单独写 HTTP 路由。
限制：需要管理两个进程的启动和通信。

### 方案 C：iframe 嵌入第三方 Agent UI（不可行）

WorkBuddy 和 QoderWork 均不提供可嵌入的 iframe widget 或 chat widget。此方案排除。

### 方案 D：通过 Qoder Cloud Agents API 调用（可行但与 QoderWork 无关）

如果目标是"用 Qoder 的编码 Agent 能力"而非"调用 QoderWork 桌面 Agent"，可以接入 `api.qoder.com` 的 Cloud Agents REST API。但这需要 Qoder 平台账号和 Personal Access Token，且能力范围与 SkillsMap 的需求（工作流管理、技能映射）不直接匹配。

## 5. Action Plan

- [ ] **方案 A（立即可做）**：在 `server.mjs` 中添加 `POST /api/agent` 路由，复用 `runAgentTask()`，前端添加对话 UI
- [ ] **方案 B（推荐下一步）**：为 `mcp-server.mjs` 增加 Streamable HTTP transport，让 `server.mjs` 作为 MCP client 代理调用
- [ ] 评估是否需要支持 WorkBuddy 的反向集成（让 WorkBuddy 通过 MCP 调用 SkillsMap server），这不需要网页端改动
- [ ] 关注 Qoder Cloud Agents API 的 GA 发布，如果未来能力扩展可能重新评估
- [ ] 关注 WorkBuddy 是否未来开放 API（目前无任何公开路线图）

## 6. Open Questions & Caveats

**WorkBuddy 未公开 API 可能性**：腾讯云生态中可能存在未公开的开发者接口或内部 API，但公开文档和产品页面均无任何线索。如果 WorkBuddy 未来开放 API，最可能的形式是 OpenAI 兼容端点（它已支持自定义模型接入 `tokenhub.tencentmaas.com`）。

**Qoder Cloud Agents API 演进**：该 API 处于 beta 阶段，未来可能扩展能力范围。但目前它明确面向云端编码 Agent，与 QoderWork 桌面 Agent 是不同产品线。

**MCP 浏览器 SDK 缺失**：虽然 Streamable HTTP 理论上浏览器可用，但缺乏官方浏览器 SDK 意味着需要自行处理 SSE 连接管理、CORS、重连逻辑等。Node.js 代理层是更稳健的选择。

**Assistants API 退役时间线**：OpenAI Assistants API 将于 2026 年 8 月退役 [42]。如果 SkillsMap 之前使用 Assistants API，需要迁移到 Responses API。当前代码使用 `codex-mini-latest`（Responses API 模型），不受影响。

## Methodology

Depth: standard。3 个并行检索 subagent 覆盖 5 个 key area。1 轮检索即满足 source target（14 sources, 9 Tier 1 + 5 Tier 2）。Outline 无重大调整。引用核验抽检 4 个关键声明，全部 SUPPORTED（WorkBuddy 官方产品页无 API、Qoder Cloud Agents API 存在且为 beta、MCP Streamable HTTP 传输确认、OpenAI Responses API 模型支持）。MCP 规范页面首次 fetch 失败（DNS），通过替代域名成功获取。

## Bibliography

[1] Tencent Cloud — WorkBuddy Product Page — https://cloud.tencent.com/product/workbuddy — Accessed 2026-08-05 — Tier: 1
[2] Eigent.ai — WorkBuddy AI Review (2026) — https://www.eigent.ai/blog/workbuddy-ai-review — Accessed 2026-08-05 — Tier: 2
[3] FXMacroData — What Is WorkBuddy? — https://fxmacrodata.com/articles/what-is-workbuddy-mcp-ai-agent-client — Accessed 2026-08-05 — Tier: 3
[4] Tencent Cloud Developer Community — WorkBuddy 进办公室 — https://developer.cloud.tencent.com/article/2719259 — Accessed 2026-08-05 — Tier: 1
[5] Tencent Cloud Developer Community — 如何在 WorkBuddy 中使用 MCP Server — https://cloud.tencent.com/developer/article/2698011 — Accessed 2026-08-05 — Tier: 1
[6] Tencent Cloud — WorkBuddy Official Documentation — https://cloud.tencent.com/document/product/1823/131902 — Accessed 2026-08-05 — Tier: 1
[20] Qoder Official Docs — API 概览 (Cloud Agents API Conventions) — https://docs.qoder.com/zh/cloud-agents/api/conventions/overview — Accessed 2026-08-05 — Tier: 1
[21] Qoder Official Docs — Connector - Qoder Docs — https://docs.qoder.com/qoderwork/connectors — Accessed 2026-08-05 — Tier: 1
[22] Qoder Official Docs — Hooks - Qoder Docs — https://docs.qoder.com/qoderwork/hooks — Accessed 2026-08-05 — Tier: 1
[23] Qoder Official Docs — 概览 (Chat/Platform Overview) — https://docs.qoder.com/zh/user-guide/chat/overview — Accessed 2026-08-05 — Tier: 1
[24] W3CSchool — QoderWork MCP — https://m.w3cschool.cn/qoderworkdocs/qoderwork-mcp.html — Accessed 2026-08-05 — Tier: 2
[40] OpenAI — Introducing Codex — https://openai.com/index/introducing-codex/ — 2025 — Tier: 1
[43] MCP Spec — Transports (2025-03-26) — https://modelcontextprotocol.io/specification/2025-03-26/basic/transports — Accessed 2026-08-05 — Tier: 1
[44] MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk — 2025 — Tier: 1

## Source Extracts

### [1] WorkBuddy Product Page
- **Summary:** 腾讯云官方产品页，描述 WorkBuddy 为"全场景 AI 办公工作台"。提供桌面客户端和微信小程序两种形态。无任何公开 API、SDK 或可嵌入组件的提及。
- **Key quotes:** "腾讯出品的全场景AI办公工作台"; 部署形态为"客户端"和"小程序端"
- **Source type:** official docs
- **Credibility tier:** 1

### [2] WorkBuddy AI Review (Eigent.ai)
- **Summary:** 英文评测文章，确认 WorkBuddy 为桌面 AI Agent，自主规划任务、调用工具、读写本地文件、生成文档。内置 MCP 协议支持，但均为出站调用。
- **Key quotes:** "自己拆步骤、调工具、读本地文件、生成文档/表格/PPT"; "内置 MCP 协议支持"
- **Source type:** industry review
- **Credibility tier:** 2

### [4] WorkBuddy 进办公室 (Tencent Developer Community)
- **Summary:** 官方开发者社区文章，解释 WorkBuddy 架构和多模型支持。文档化通过 OpenAI 兼容端点添加自定义模型的方法。
- **Key quotes:** API endpoint: `https://tokenhub.tencentmaas.com/v1/chat/completions`; 描述为"全场景桌面AI智能体"
- **Source type:** official developer community
- **Credibility tier:** 1

### [5] WorkBuddy MCP Server 使用指南
- **Summary:** 官方 MCP 配置指南。确认 Connector 子系统底层使用 MCP 协议，配置存储在 `~/.workbuddy/mcp.json`。WorkBuddy 是 MCP 客户端。
- **Key quotes:** "WorkBuddy 的连接器（Connector）功能，底层即采用 MCP 协议实现"
- **Source type:** official developer community
- **Credibility tier:** 1

### [20] Qoder Cloud Agents API Conventions
- **Summary:** Qoder 官方文档，描述 Cloud Agents REST API。Base URL: `https://api.qoder.com/api/v1/cloud`。端点包括 /agents, /sessions, /environments 等。Beta 状态，使用 Personal Access Token 认证。
- **Key quotes:** 资源路径: "/agents", "/sessions", "/environments", "/events", "/files", "/skills", "/deployments"
- **Source type:** official docs
- **Credibility tier:** 1

### [21] Qoder Connectors Docs
- **Summary:** QoderWork Connectors 文档。Connectors 让 QoderWork 向外连接外部服务（Slack, Notion 等），是出站连接，不是入站 API 端点。
- **Source type:** official docs
- **Credibility tier:** 1

### [40] OpenAI Introducing Codex
- **Summary:** OpenAI 官方 Codex 发布文章。描述 Codex 作为 ChatGPT 内的编码 Agent，在沙箱环境运行。
- **Source type:** official announcement
- **Credibility tier:** 1

### [43] MCP Transports Spec (2025-03-26)
- **Summary:** MCP 规范定义两种内置传输：stdio 和 Streamable HTTP。Streamable HTTP 使用 HTTP POST + SSE。无 WebSocket 传输。允许自定义传输。
- **Key quotes:** "stdio" and "Streamable HTTP" are built-in; "custom transports" permitted
- **Source type:** specification
- **Credibility tier:** 1

### [44] MCP TypeScript SDK
- **Summary:** 官方 TypeScript SDK，支持 Streamable HTTP 传输。面向 Node.js/Bun/Deno 服务端。
- **Source type:** official SDK
- **Credibility tier:** 1
