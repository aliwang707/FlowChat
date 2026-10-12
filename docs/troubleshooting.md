# 常见错误与排错记录（Troubleshooting）

> 本文档汇总了 FlowChat 开发与部署过程中遇到的 30+ 个典型 Bug，按“现象 -> 根因 -> 排查思路 -> 解决/教训”整理。这不仅是问题记录，更是我系统性排查能力与工程思维的体现。

---

## 🛠️ 一、排错方法论（面试官重点看）

经过大量真实踩坑，我总结出一套标准化的调试心法，避免盲目试错：

1. **二分定位法**：先判断是“前端问题”还是“后端问题”。利用浏览器 Network 面板看请求状态：
   - 看到 401 → 查鉴权/环境变量
   - 看到 500 → 查 Vercel Function Logs
   - 看到 `fetch failed` → 查网络/上游 API 连通性
2. **逐层验证（API 调试专用）**：网络连通 → 鉴权格式（Bearer 空格/前缀） → Key 有效性（余额/端点） → 请求体格式（JSON/字段名） → 响应结构（对照文档逐层取）。
3. **最小化复现**：剥离所有业务逻辑，只保留最小请求（如直接用 `curl` 打上游 API）。如果最小请求能通，问题在业务代码；不通，问题在配置或网络。
4. **日志即证据**：在关键节点打印日志（如 `console.error` 输出完整响应），保留现场证据。

---

## 🚨 二、核心排查维度与典型案例

### 维度一：流式传输与 SSE 边界问题（最复杂、最耗时）

| 现象 | 根因方向 | 解决方案 |
| --- | --- | --- |
| **中文乱码（`nâ` 等）** | TCP 分包切断 UTF-8 多字节字符（中文占 3 字节） | 改用 `TextDecoderStream`，或使用 `buffer` 拼接不完整字符后再 `decode(chunk, { stream: true })` |
| **流式输出重复/停不下来** | 高频 state 更新导致渲染风暴，或模型陷入重复循环 | 引入 `lodash.throttle` 节流；前端检测重复 token 自动中止 |
| **末尾丢字 / 数据不完整** | 流结束时缓冲区未刷出，或缺少 `X-Accel-Buffering: no` 头导致代理缓冲 | 流结束时强制 `flush()`；响应头添加 `X-Accel-Buffering: no` 和 `Content-Type: text/event-stream` |
| **前端收不到流式数据** | 前端仍用 `response.json()` 而非 `getReader()`；后端未设置 SSE 头 | 前端改用 `response.body.getReader()` 逐块读取；后端确保响应头正确 |

### 维度二：前后端数据契约与状态管理（最隐蔽）

| 现象 | 根因方向 | 解决方案 |
| --- | --- | --- |
| **`message` vs `messages` 单复数对不上** | 前端发 `{ messages: [...] }`（复数），后端解构写 `const { message }`（单数），拿到 `undefined` | 全局搜索并统一前后端 Key 名。**Key 名是字面量匹配，差一个字母就是 `undefined`** |
| **`fetch` 返回值直接当数据用** | `const data = await fetch(...)` 未执行 `.json()`，`data` 是 Response 对象 | 严格区分两步：`const res = await fetch(...)` → `const data = await res.json()` |
| **React Key 警告（内容重复）** | 用消息内容 `key={m}` 做 key，连续发相同内容导致 key 重复 | 改用 `crypto.randomUUID()` 或数据库 `id` 作为 key。**Key 必须稳定且唯一** |
| **快速切换会话导致数据错乱** | 竞态条件（Race Condition）：旧请求的慢响应覆盖了新请求的数据 | 引入 `requestId`，返回时比对最新 ID，不匹配则丢弃；使用 `messagesRef` 解决闭包陷阱（Stale Closure） |
| **TypeScript 类型定义与实际使用不符** | `useState<{role, message}>` 但代码构造和渲染用 `content` | 类型定义是“承诺”，放、存、取三处必须统一。全文统一为 `content`（与 AI 接口格式一致） |

### 维度三：鉴权、环境变量与数据库权限（部署杀手）

| 现象 | 根因方向 | 解决方案 |
| --- | --- | --- |
| **401 Unauthorized（API Key 无效）** | Key 前缀重复（`sk-sk-`）；端点写错（国内 Key 只认 `.cn`，不是 `.com`）；VPN 代理导致流量出国 | 逐层验证：删旧 Key 重建 → 检查前缀 → 确认端点 → 检查余额与实名 |
| **环境变量缺失导致静默失败** | Vercel 控制台未配置变量，或作用域未勾选 `Production`；未执行 Redeploy | 引入 Zod 在启动时校验 `process.env`，缺失则直接构建失败（Fail Fast）；修改变量后必须 Redeploy |
| **Supabase 写入失败（42501 Permission denied）** | 后端误用了前端可见的 `anon key`（受 RLS 限制），应改用 `service_role key` | 后端 `lib/supabase.ts` 使用 `SUPABASE_SERVICE_ROLE_KEY`；确保该文件不被前端 import |
| **Supabase RLS 报错 `text = uuid`** | 数据库表 `user_id` 为 text 类型，与 Supabase 原生 `auth.uid()` 的 uuid 类型不匹配 | 放弃原生 RLS，改用 Clerk 鉴权 + 后端服务进行身份校验（BFF 模式） |
| **Clerk 鉴权 401（本地正常，线上失败）** | 前端 `publishableKey` 与后端 `secretKey` 环境不一致（前端 prod，后端 test） | 确认两套 Key 来自同一环境；在 Clerk 后台把 Vercel 域名加入白名单 |

### 维度四：框架特性与构建部署（Next.js / Vercel 专属）

| 现象 | 根因方向 | 解决方案 |
| --- | --- | --- |
| **405 Method Not Allowed** | Route Handler 函数名写成小写 `post` | Next.js 只认大写 `POST`，改为 `export async function POST()` |
| **GET 动态路由返回 404** | Next.js 15 中 `params` 改为 Promise，未 `await` 导致 ID 为 `undefined` | `const { id } = await params;` |
| **生产模式“保存消息失败”** | `next start` 加载的是构建产物，代码改动后未重新构建 | 将“清理缓存 + 重新构建 (`npm run build`)”纳入标准操作流程 |
| **Vercel 部署后流式中断/超时** | Serverless 函数执行时间触达 `maxDuration` 上限（默认较短） | 在 `app/api/chat/route.ts` 导出 `export const maxDuration = 60`；调整首字节超时 |
| **Vercel 构建失败（TypeScript 错误）** | 本地 `npm run dev` 正常，但 `npm run build` 报错 | 养成 push 前本地跑一次 `npm run build` 的习惯，提前拦截 90% 的线上构建失败 |

### 维度五：UI 渲染与交互体验

| 现象 | 根因方向 | 解决方案 |
| --- | --- | --- |
| **复制按钮遮挡文字 / 移动端无 hover** | `group-hover` 作用于兄弟元素而非子元素；移动端无 hover 概念 | 调整 DOM 层级，移动端常显按钮，桌面端 hover 显示 |
| **“正在思考”动画不消失** | 节流导致首个 token 未及时刷新 UI | 首个 token 立即更新，后续 token 走节流，兼顾流畅与性能 |
| **Markdown 表格显示混乱** | AI 未严格遵循 Markdown 表格语法（缺少分隔线、列数不一致） | System Prompt 明确表格格式；前端增加表格修复/降级展示；容器横向滚动 |
| **代码块深浅色不同步** | 未根据 `prefers-color-scheme` 切换语法高亮主题 | 检测系统主题并切换高亮主题；复制按钮同样使用 `dark:` 样式 |

---

## 🔍 三、经典复盘：流式输出乱码的“三轮攻坚”

**现象**：AI 回复中文乱码，代码块不完整。
**排查过程**：
1. **第一轮（编码层）**：怀疑前端解码 → 检查 `TextDecoder`，发现手动 buffer 拼接有缺陷 → 改用 `TextDecoderStream` 后乱码消失。
2. **第二轮（渲染层）**：出现**内容重复** → 怀疑渲染频率 → 发现每个 token 都触发 state 更新，引入 `lodash.throttle` 节流后重复消失。
3. **第三轮（数据层）**：代码混入中文 → Network 面板确认**后端原始响应就有问题** → 后端加空数据块防御 + 移除 `stream_options`，彻底解决。

**复盘收获**：同一现象可能对应**多个层次**的 Bug。**Network 面板**是判断「前端问题 vs 后端问题」的分水岭，必须逐层剥离，定位到根因。

---

## 📊 四、核心能力沉淀

| 能力维度 | 具体体现 |
| --- | --- |
| **系统性排查** | 按“前端 -> 网络 -> 后端 -> 上游”分层定位，而非盲目试错 |
| **工具运用** | 熟练使用 DevTools Network 面板、Vercel Function Logs、终端报错信息 |
| **防御性编程** | 对 AI 输出做 `try-catch` JSON 解析、清洗异常标记、兜底 UI；环境变量启动时校验 |
| **框架理解** | 深入理解 Next.js 15 路由变化、React 状态更新竞态、SSE 流式传输机制 |
| **工程规范** | 在 VS Code 中使用 SonarLint 实时扫描，理解规则背后的工程意义（如认知复杂度、空 catch 块），并据此重构了深层嵌套的错误处理逻辑。 |

---