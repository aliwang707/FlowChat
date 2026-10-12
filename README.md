# FlowChat

一个基于 Next.js 的全栈 AI 聊天应用，支持 SSE 流式对话、多会话管理、Clerk 登录鉴权、Supabase 消息持久化与 Vercel 部署。

- 🔗 Demo: https://flowchat.boleit.cn/ （自定义域名已绑定）
- 📦 仓库: https://github.com/aliwang707/FlowChat
- 📄 排错记录: [docs/troubleshooting.md](docs/troubleshooting.md)

## 项目简介

FlowChat 是一个以聊天为核心的全栈 Web 应用，目标是提供近实时的 AI 对话体验，并将会话内容、访问控制、接口安全与生产部署一并纳入工程设计。

项目适合用于个人助手、知识问答、聊天机器人原型等场景，也可以作为 Next.js + AI 应用的学习与展示项目。


## 界面预览

![浅色模式](./public/screenshot-light.png)
![深色模式](./public/screenshot-dark.png)

> 支持浅色/深色模式自动适配，提供舒适的夜间使用体验。

## 核心功能

- 流式 AI 对话：使用 Server-Sent Events 逐 token 返回模型输出，提升响应体验
- 多会话管理：支持创建、切换、删除多个聊天会话
- 消息持久化：会话和消息保存在 Supabase 中
- 登录鉴权：使用 Clerk 完成用户身份校验
- 停止生成：支持中断 AI 输出，并保留已生成内容
- 超时取消：使用 `AbortController` 级联取消上游请求，避免浪费 Token
- 安全与限流：Zod 校验请求参数，API 层实施基础速率限制
- 环境变量校验：启动时用 Zod 校验 `process.env`，缺失即构建失败
- Markdown 渲染：支持列表、代码块、表格等富文本展示
- 响应式 UI：适配移动端与桌面端，支持深色模式

## 技术栈

| 类别 | 技术项 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 16 | App Router 与服务端 API 能力 |
| 前端 | React 19 + TypeScript | 组件化 UI 与类型安全 |
| 样式 | Tailwind CSS | 快速构建现代 UI |
| 数据库 | Supabase | 会话与消息存储 |
| 认证 | Clerk | 用户身份校验与访问控制 |
| AI 接口 | SiliconFlow / OpenAI 兼容接口 | 大语言模型调用入口 |
| 部署 | Vercel | Next.js 项目的推荐托管平台 |
| 校验 | Zod | 请求参数校验 |
| 工具 | lodash.throttle、react-markdown | 流式渲染优化与 Markdown 展示 |

## 学习文档
- [学习过程](docs/learning-log.md)
- [AI 协作说明](docs/ai-collaboration.md)
- [部署指南](docs/deployment-vercel.md)
- [排错指南](docs/troubleshooting.md)

## 架构简述

请求链路如下：

```mermaid
flowchart LR
A[前端输入] --> B[hooks/useChatStream]
B --> C[Next.js API /api/chat]
C --> D[模型服务]
C --> E[Supabase 存储]
E --> F[SSE 流式返回]
F --> G[UI 增量更新]
```

核心流程：
1.前端输入交给 useChatStream 处理。
2.服务端 API 校验用户身份、请求参数与频率。
3.服务端调用 AI 模型服务，并以 SSE 流式写回。
4.系统同时更新 Supabase 中的会话与消息记录。
5.前端逐块解析，按 token 增量更新 UI。

更完整的部署与排错记录见 (docs/deployment-vercel.md) 和 (docs/troubleshooting.md)

## 环境变量配置

本项目在本地开发时需要通过 `.env.local` 配置环境变量，部署到 Vercel 时也需要在后台 Environment Variables 中配置同名变量。

```bash
cp .env.example .env.local
```

| 变量名 | 说明 | 是否必填 | 是否公开到前端 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 是 | 是 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名键，仅用于公开访问场景 | 是 | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key，仅服务端使用 | 是 | 否 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 前端公钥 | 是 | 是 |
| `CLERK_SECRET_KEY` | Clerk 服务端密钥 | 是 | 否 |
| `SILICONFLOW_API_KEY` | SiliconFlow 模型调用密钥 | 是 | 否 |
| `SILICONFLOW_BASE_URL` | SiliconFlow 接口地址 | 是 | 否 |
| `NEXT_PUBLIC_APP_URL` | 当前应用访问地址 | 否 | 是 |
| `AI_MODEL` | 默认模型名称 | 否 | 否 |
| `AI_MAX_TOKENS` | 最大输出长度 | 否 | 否 |
| `AI_TEMPERATURE` | 生成温度参数 | 否 | 否 |
| `AI_TOP_P` | Top-p 参数 | 否 | 否 |

> 安全说明：`NEXT_PUBLIC_` 前缀的变量会在构建时被嵌入前端代码，因此只能使用匿名级公开配置，绝不能把 service role key、API key 或高权限凭据放入此类变量中。
>
> 所有真实密钥必须只存放在本地 `.env.local` 和 Vercel 后台的 Environment Variables 中，不得提交到 GitHub 仓库。

## 本地运行

```bash
git clone <repository-url>
cd FlowChat
npm install
cp .env.example .env.local
npm run dev
```

访问：

```text
http://localhost:3000
```

推送到远程仓库前，建议先执行：

```bash
npm run build
提前拦截 TypeScript 类型错误和构建失败。


## 部署说明

本项目以 Vercel 作为部署平台，GitHub 仓库的 `main` 分支更新后，将触发 Vercel 的自动部署流程。

部署到 Vercel 后，需要在后台进入：

`Project -> Settings -> Environment Variables`

并配置以下变量，并根据需要选择作用域（Production / Preview / Development）：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLERK_SECRET_KEY`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_BASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `AI_MODEL（可选）`
- `AI_MAX_TOKENS（可选）`
- `AI_TEMPERATURE（可选）`
- `AI_TOP_P（可选）`

配置完成后，必须执行一次 Redeploy，环境变量修改才会生效。

> 注意：`NEXT_PUBLIC_` 变量会在构建时被内联到前端代码，因此它们需要是公开可见的匿名配置，不能放入高权限秘钥。

## 已知限制

- 内存限流在 Serverless 多实例部署下不共享，仅用于演示；生产环境建议接入 Redis 或 Vercel KV。
- 单元测试覆盖了核心入参校验（Zod Schema），后续计划补充 API 路由集成测试。
- 模型输出质量依赖上游 AI 服务。
- 暂未支持 RAG、Function Calling / Tool Use。

## 安全声明

- 所有真实密钥仅存于本地 `.env.local` 和 Vercel 后台环境变量中
- 不提交 `.env.local`、`.env.*.local` 或任何真实凭据到 GitHub
- 本仓库仅保留示例值或占位符，不包含真实的 Supabase 地址、API Key 或服务端密码


## 许可证

本项目采用 MIT License，详情请见 [LICENSE](./LICENSE)。
