# Vercel 部署全记录与踩坑复盘

> 将 Next.js 全栈项目（FlowChat）部署到 Vercel 并稳定运行的完整历程。涵盖环境变量隔离、SSE 流式传输优化、Serverless 连接池限制，以及生产环境的排错思维。

---

## 一、部署前准备与检查清单

部署不是简单的“点按钮”，而是检验项目健壮性的第一步。上线前我做了以下准备：

1. **代码准备**：将代码推送到 GitHub 仓库，确保 `.env.local` 已被 `.gitignore` 忽略，并提供 `.env.example` 作为环境变量模板。
2. **本地构建验证**：本地执行 `npm run build` 确保没有 TypeScript 类型错误和依赖冲突。这一步非常关键，它帮我提前拦截了大部分线上构建失败。
3. **外部服务就绪**：
   - **Clerk**：获取生产环境 API Key（注意不能在 Production 环境使用 Development 实例的 Key）。
   - **Supabase**：获取项目 URL、Anon Key 和 Service Role Key，并在生产库执行建表 SQL（`sessions` 和 `messages`）。
   - **SiliconFlow**：获取 API Key。
4. **环境变量梳理**：严格区分前端可见与后端保密的变量。

| 变量名 | 用途 | 是否公开到前端 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 是 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名键（前端用） | 是 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 前端公钥 | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥（后端用） | 否 |
| `CLERK_SECRET_KEY` | Clerk 服务端密钥 | 否 |
| `SILICONFLOW_API_KEY` | AI 模型调用密钥 | 否 |
| `SILICONFLOW_BASE_URL` | AI 接口地址 | 否 |
| `AI_MODEL` / `AI_MAX_TOKENS` | 可选参数 | 否 |

> ⚠️ **安全原则**：服务端密钥绝对不加 `NEXT_PUBLIC_` 前缀，否则会被打包进前端代码，导致 API Key 泄露被恶意刷爆。

---

## 二、Vercel 部署流程

1. 登录 Vercel Dashboard，点击 `Add New` → `Project`。
2. 关联并导入我的 GitHub 仓库。
3. **框架识别**：Vercel 自动识别为 Next.js，Framework Preset 保持默认。
4. **配置环境变量**：在 `Settings -> Environment Variables` 中逐一添加上述变量。
   - **注意作用域**：务必勾选 `Production`、`Preview` 和 `Development`，否则线上环境可能读不到变量。
5. **触发部署**：点击 `Deploy`，等待构建完成。
6. **绑定域名**：Vercel 自动分配 `xxx.vercel.app` 域名。后续我绑定自定义域名 `flowchat.boleit.cn`，并配置了 DNS 解析。

---

## 三、核心踩坑与排错实录

### 🐛 坑位一：环境变量修改后不生效

**现象**：线上页面能加载，但一发送消息就报 500。

**排查过程**：
1. 打开 Vercel 项目面板，进入 `Logs` (Runtime Logs)。
2. 查看报错信息，发现提示 `Error: Missing SUPABASE_SERVICE_ROLE_KEY`。
3. 回到 `Settings -> Environment Variables`，发现我确实添加了变量，但作用域只勾选了 `Preview`，没有勾选 `Production`。

**解决**：
1. 重新编辑变量，勾选 `Production` 并保存。
2. **关键动作**：在 `Deployments` 页面点击最新一次部署的 `Redeploy`。环境变量是在构建时注入的，修改后必须重新部署才会生效，刷新页面是没用的。

### 🐛 坑位二：Vercel 海外服务器连不上国内 AI 端点

**现象**：本地调用 SiliconFlow API 正常，部署到 Vercel 后请求超时或报错。

**排查与解决**：
1. Vercel 的服务器在海外，调用国内端点 `api.siliconflow.cn` 可能网络不通。
2. **解决方案**：将环境变量中的 `SILICONFLOW_BASE_URL` 切换为国际节点 `https://api.siliconflow.com`。
3. **备选方案**：如果国际节点也不稳定，可以更换为兼容 OpenAI 协议的国产模型（如 DeepSeek、智谱、Moonshot），或增加超时重试机制。

### 🐛 坑位三：SSE 流式输出在 Vercel 上被缓冲/中断

**现象**：AI 回复不是逐字显示，而是等了很久一次性蹦出来，或者流式突然断开。

**排查与解决**：
1. 确认响应头是否设置了 `Content-Type: text/event-stream`。
2. **关键配置**：在响应头中添加 `X-Accel-Buffering: no`，防止 Vercel 边缘代理缓冲 SSE 流。
3. 确认前端使用 `response.body.getReader()` 读取，而不是 `response.json()`。
4. **Serverless 超时限制**：Vercel 免费套餐函数执行时间有限。我在 `app/api/chat/route.ts` 中导出了 `export const maxDuration = 60` 来延长执行时间。同时，将首字节超时设为 25 秒，避免长时间等待空白流。具体 `maxDuration` 以当前 Vercel 计划允许范围为准。

### 🐛 坑位四：Supabase 数据库连接超时（Serverless 限制）

**现象**：本地开发环境数据库读写正常，部署到 Vercel 后偶尔出现连接超时或 `42501 Permission denied`。

**排查与解决**：
1. **连接池**：Vercel 是 Serverless 环境，每次请求可能创建新连接，导致 Supabase 连接数耗尽。将数据库连接方式从直连切换为 Connection Pooling（端口 6543），问题明显缓解。
2. **权限问题**：检查是否误用了 `anon key` 进行后端写入操作。后端应改用 `service_role` key。
3. **RLS 策略**：确认 Supabase 行级安全策略未阻止插入操作。开发环境可以关闭 RLS 方便调试，生产环境务必开启并配置正确 Policy。
4. **内存限流失效**：由于 Serverless 多实例部署，内存中的 Map 限流无法跨实例共享，仅用于演示。生产环境建议接入 Vercel KV 或 Redis。

### 🐛 坑位五：Clerk 鉴权返回 401

**现象**：Vercel 线上登录后调用 API 仍然返回 401，本地正常。

**排查与解决**：
1. 确认 `CLERK_SECRET_KEY` 已配置且未过期。
2. 确认前端 `<ClerkProvider>` 的 `publishableKey` 与后端 `secretKey` 是**同一套环境**（不能前端用 Production，后端用 Development）。
3. **回调域名**：需要在 Clerk 后台把 Vercel 的域名加入白名单，并配置正确的重定向 URL。

---

## 四、部署后验证清单

- [ ] 页面能正常加载（无白屏、无 500）
- [ ] 未登录用户无法调用 `/api/chat`（返回 401）
- [ ] 登录后能发送消息并收到 AI **流式**回复（逐字显示）
- [ ] 新建会话后，刷新页面历史记录**不丢失**
- [ ] 环境变量正确注入（无 401 / 认证错误）
- [ ] 移动端显示正常（Tailwind 响应式）
- [ ] 连续发送 20+ 条消息，无内存溢出或卡顿
- [ ] 断网 / API 故障时前端有友好提示（而非白屏或卡死）
- [ ] Vercel Function Logs 无异常报错
- [ ] 深色模式跟随系统正常切换

---

## 五、部署总结与反思

部署不仅仅是“点一下按钮”，它让我深刻理解了**生产环境与本地开发环境的巨大差异**：

1. **环境变量注入机制**：Next.js 的 `NEXT_PUBLIC_` 前缀只在构建时内联，后端密钥必须严格隔离。
2. **Serverless 特性**：函数超时、冷启动、内存状态不共享、数据库连接池管理，这些都是前端开发无法体会到的后端工程细节。
3. **网络与区域**：Vercel 的部署区域直接影响 API 调用的延迟与可用性。
4. **排错思维**：遇到 500 不要慌，第一时间看 Vercel Runtime Logs，顺着报错定位是环境变量、网络还是代码逻辑问题。

这段部署经历让我具备了从本地开发到云端上线的完整交付能力，也让我更有信心面对生产环境中的各种挑战。