# Web 应用开发手册

> 适用：从零构建一个可在现代浏览器（含移动端）运行的 Web 应用。
> 范围：需求 → 设计 → 前后端开发 → 测试 → 部署上线 → 迭代。
> 不包含：原生移动 App、重客户端桌面应用、独立后端中台。
> 技术选型给出主流可落地选项，按需取舍，不做唯一推荐。

---

## 0. 技术选型速查（先定，后面少返工）

| 层 | 主流选择 | 何时选 |
|---|---|---|
| 前端框架 | React / Vue / Svelte | React 生态最大；Vue 上手快；Svelte 体积小 |
| 前端构建 | Vite | 默认选，快且主流 |
| 样式 | Tailwind CSS / CSS Modules / 组件库（Ant Design、Element Plus、shadcn/ui） | 快速出界面用组件库；要定制用 Tailwind |
| 后端语言 | Node.js / Python / Go / Java | Node 与前端同语言；Python 数据分析友好；Go/Java 高并发 |
| 后端框架 | Express / FastAPI / Gin / Spring Boot | 轻量选 Express/FastAPI；企业选 Spring |
| 数据库 | PostgreSQL / MySQL / SQLite / MongoDB | 关系型首选 PostgreSQL；嵌入式/原型用 SQLite |
| ORM | Prisma / Drizzle / SQLAlchemy / GORM | 类型安全优先 Prisma/Drizzle |
| 部署 | 静态托管（Vercel/Netlify/云托管）/ 容器（Docker + 云 K8s）/ PaaS | 纯前端选静态托管；全栈选容器/PaaS |
| 鉴权 | 会话 Cookie / JWT / OAuth2 | 传统选会话；前后端分离选 JWT；第三方登录选 OAuth |

**决策原则**：先用最小可行栈跑通主线（如 React + Vite + Node/Express + SQLite + 静态托管），再按需升级。避免早期过度设计。

---

## 1. 需求与规划

**目标**：用一句话说清「为谁解决什么问题」，并锁定核心场景与优先级。

- **用户研究**：列出最早使用的 1–2 类用户；记录他们现在如何完成这件事（竞品/手工）。
- **核心场景**：写成「作为 <角色>，我想 <动作>，以便 <价值>」的用户故事，挑 Top 3–5。
- **技术选型**：按第 0 节定栈，记录关键决策与理由（便于后人理解）。
- **信息架构**：画出页面树与主要路由（如 `/`、`/login`、`/dashboard`、`/item/:id`）。
- **验收标准**：明确「做到什么算完成」（如：核心路径可在浏览器跑通、关键接口有测试）。

**交付物**：一份 1–2 页的需求说明 + 页面路由图 + 技术选型记录。

---

## 2. UI/UX 设计

**目标**：在写代码前对齐界面与交互，降低返工。

- **线框图**：用 Figma / 墨刀 / 草图，覆盖核心页面与空态、加载态、错误态。
- **交互流程**：标注主要操作的前后置条件（如未登录访问 `/dashboard` 跳登录）。
- **设计系统**：定色彩（主色/中性色）、字体层级、间距（4/8 倍数）、圆角与阴影规范。
- **响应式**：定断点（移动 <768、平板 <1024、桌面 ≥1024），关键页面双端走查。

**交付物**：关键页面设计稿 + 设计令牌（颜色/字号/间距）文档。

---

## 3. 前端开发

**目标**：搭好工程并实现页面与交互。

- **脚手架**：`npm create vite@latest`（React/Vue），配 ESLint + Prettier + 目录约定（如 `pages/`、`components/`、`api/`、`hooks/`）。
- **组件化**：页面由可复用组件拼装；保持组件单一职责，展示与逻辑分离。
- **状态管理**：局部用框架内置（React `useState`/Vue `ref`）；跨页共享用 Context/Pinia/Zustand；服务端数据用查询库（TanStack Query / SWR）。
- **路由**：客户端路由（React Router / Vue Router），配懒加载与鉴权守卫。
- **接口对接**：集中封装 `api/` 层（带 baseURL、超时、错误处理、Token 注入）；统一错误提示与 loading 态。
- **可访问性**：语义化标签、表单 label、键盘可达、对比度达标。

**检查点**：核心页面可点击联调；刷新/路由切换状态不丢；空/错/载三态完善。

---

## 4. 后端开发

**目标**：提供稳定、安全的接口与数据。

- **API 设计**：REST 为主，资源用名词复数（`/users`、`/orders`）；统一响应结构 `{code,data,message}`；版本前缀 `/api/v1`；用 OpenAPI 记录契约。
- **数据建模**：先画 ER 图，定表/集合、字段类型、索引、关系；用迁移工具（Prisma Migrate / Alembic）管理 schema 变更。
- **鉴权**：注册/登录 → 签发会话或 JWT；密码必须哈希（bcrypt/argon2）；敏感接口做权限校验；刷新令牌单独管理。
- **业务逻辑**：把规则放在 service 层，controller 只做参数校验与响应；避免把 SQL/业务写进路由。
- **输入校验**：所有入参服务端再校验（zod / Joi / pydantic），不信任前端。

**检查点**：关键接口有 OpenAPI 描述；鉴权覆盖受保护路由；错误有稳定结构。

---

## 5. 集成与质量

**目标**：联调通过、质量可控。

- **前后端联调**：统一时间/错误/分页格式；前端 mock 与真实接口切换顺畅；联调清单逐条过。
- **自动化测试**：
  - 单元：核心函数/纯逻辑（Vitest / Jest / pytest）。
  - 集成：接口层（Supertest / pytest + httpx）。
  - 端到端：关键用户路径（Playwright / Cypress）。
- **性能**：前端做代码分割、图片优化、缓存；后端加索引、避免 N+1、加缓存（Redis）；用 Lighthouse 量分。
- **安全**：防 SQL 注入（参数化）、XSS（转义/CSP）、CSRF（同源策略/令牌）、依赖漏洞（`npm audit` / `pip-audit`）；密钥走环境变量，绝不进仓库。

**检查点**：CI 跑测试通过；Lighthouse 性能分 ≥ 可接受阈值；`audit` 无高危依赖。

---

## 6. 部署与运维

**目标**：一键可上线、出事可追溯。

- **CI/CD**：提交触发构建+测试（GitHub Actions / GitLab CI）；通过后自动部署到预发/生产。
- **容器化**：写 `Dockerfile`（多阶段构建）+ `docker-compose`（含数据库）；生产用云容器/K8s 或 PaaS。
- **托管**：纯前端用 Vercel/Netlify/静态云托管；全栈用云托管/容器服务；数据库用托管实例（省运维）。
- **域名与 HTTPS**：绑定域名，签发免费证书（Let's Encrypt / 平台自带），强制 HTTPS 跳转。
- **监控日志**：接错误监控（Sentry 类）、集中日志、基础告警（5xx/延迟/宕机）。

**检查点**：一次命令或一次合并即可上线；HTTPS 正常；错误能收到告警。

---

## 7. 上线与迭代

**目标**：平稳发布、用数据驱动改进。

- **发布策略**：先灰度/小流量，再全量；预备回滚（保留上一镜像/版本，一键回退）。
- **数据反馈**：接入基础埋点（PV/关键转化）+ 用户反馈入口；定期看数据定下个迭代。
- **技术债**：每迭代留 10–20% 修债（测试补全、性能、可读性）。

**检查点**：有回滚预案且验证过；有周/双周迭代节奏；反馈有归口处理。

---

## 附录 A：推荐工具链

- 脚手架：Vite、Create React App 替代、Nuxt/SvelteKit（全栈框架可省后端）
- 接口调试：Postman / Bruno / curl
- 数据库 GUI：TablePlus / DBeaver
- 版本控制：Git + 约定式提交（Conventional Commits）
- 文档：OpenAPI（Swagger）、README 写明本地启动步骤

## 附录 B：上线前检查清单

- [ ] 核心用户路径在浏览器（含移动端）跑通
- [ ] 关键接口有测试且 CI 通过
- [ ] 鉴权/权限覆盖受保护路由
- [ ] 密钥全部走环境变量，无硬编码
- [ ] 已绑定域名并强制 HTTPS
- [ ] 错误监控 + 日志 + 告警就位
- [ ] 回滚方案验证可用
- [ ] README 含本地启动与部署说明

---

> 说明：本手册由 AI 基于通用 Web 开发最佳实践直接生成，供立即使用。
> 在 Capability Atlas 中已建对应工作流草案（id `7bc7e2d0-437d-465a-a565-bfafe3ae0797`）与项目简报草案；
> 如需生成 Atlas 官方 Playbook（带本地 Skill 能力映射），请在网页 UI 中对该简报执行「冻结（freeze）」，
> 随后即可由 `generate_playbook_draft` + `export_playbook` 产出。
