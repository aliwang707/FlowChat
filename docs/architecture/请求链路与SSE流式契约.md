# 请求链路与 SSE 流式契约

> 最后核对：2026-10-13
>
> 本文是 FlowChat 端到端请求链路与流式协议的权威描述。决策背景见 [ADR 0002](../adr/0002-SSE流式响应协议.md)。

## 1. 端到端链路

```
ChatInput.onSubmit
  → useChatStream.handleSubmit
      ├─ 组装 messages（最近 20 条、去空、去 loading 占位）
      ├─ 立即插入用户气泡 + AI 占位气泡（isLoading: true）
      ├─ AbortController（120s 超时）
      └─ POST /api/chat
            → auth() 取 userId              [未登录 → 401]
            → rateLimit(userId)             [超限 → 429]
            → request.json()                [解析失败 → 400]
            → ChatRequestSchema.safeParse   [失败 → 400]
            → 末条消息必须是 user            [否则 → 400]
            → resolveSession(userId, sid)   [无 sid 新建 / 有 sid 校验归属]
            → saveUserMessage(sid, content)
            → fetchAIResponse(...)          [网络失败 → 502 / 非 2xx → 502]
            → createSSEResponse(...)        → text/event-stream
                  └─ StreamProcessor 解析上游 → onToken 逐条 enqueue
                                                  ↓
      ← 浏览器 getReader() 逐块读取 → 跨 chunk 拼行 → JSON.parse → 追加 token
```

## 2. 客户端 → 服务端契约

- **方法 / 路径**：`POST /api/chat`
- **请求头**：`Content-Type: application/json`；凭据随 `credentials: 'include'`
- **请求体**：

```json
{
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "你好！我可以帮你。" }
  ],
  "sessionId": "可选，UUID v4 字符串"
}
```

| 字段 | 约束 | 来源 |
|---|---|---|
| `messages` | 数组，长度 1～20 | `ChatRequestSchema` |
| `messages[].role` | `'user' \| 'assistant' \| 'system'` | `MessageSchema` |
| `messages[].content` | 字符串，长度 1～10000 | `MessageSchema` |
| `messages[].*` | 不允许额外字段（`strict`） | `MessageSchema` |
| `sessionId` | 可选，必须是合法 UUID | `ChatRequestSchema` |

## 3. 服务端 → 客户端契约

- **状态码与响应体**

| 状态 | 触发条件 | 响应体 |
|---|---|---|
| 200 | 建立 SSE 流 | `text/event-stream` |
| 400 | JSON 解析失败 | `{ "error": "JSON请求格式错误" }` |
| 400 | Schema 校验失败 | `{ "error": "请求参数校验失败：<path>:<message>; ..." }` |
| 400 | 末条消息角色不是 `user` | `{ "error": "最后一条消息必须来自用户" }` |
| 401 | 未登录 | `{ "error": "请先登录" }` |
| 408 | 上游请求被取消 / 超时 | `{ "error": "请求超时或被取消" }` |
| 429 | 触发限流 | `{ "error": "请求过于频繁，请稍后再试" }` |
| 500 | 未捕获异常 | `{ "error": "服务器内部错误", "detail": "...", "stack": 仅开发环境 }` |
| 502 | 上游网络错误 | `{ "error": "AI 服务网络错误" }` |
| 502 | 上游返回非 2xx | `{ "error": "AI 服务暂时不可用 (<status>)" }` |
| 502 | 上游无 `body` | `{ "error": "无法获取响应流" }` |

- **SSE 响应头**（`lib/sse-response.ts`）

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Content-Encoding: identity
```

`X-Accel-Buffering: no` 用于阻止边缘代理缓冲，是流式体验能否成立的关键头。

- **SSE 事件载荷**

正常 token（每条事件都带 `sessionId`）：

```
data: {"token":"你","sessionId":"<uuid>"}

```

上游中断时追加一条终止事件（当前实现不带 `sessionId`）：

```
data: {"token":"\n\n[生成已中断]"}

```

前端解析规则：只处理以 `data:` 开头的行；`[DONE]` 直接跳过；`JSON.parse` 失败的行静默忽略（用于吞掉不完整的 chunk 边界）。

## 4. 上游模型契约

`lib/ai-service.ts` 是唯一出网点，向 `${SILICONFLOW_BASE_URL}/chat/completions` 发送 OpenAI 兼容请求：

| 字段 | 值 |
|---|---|
| `model` | `env.AI_MODEL`（默认 `Qwen/Qwen2.5-7B-Instruct`） |
| `messages` | `[{ role: "system", content: "你是一个专业、友好的AI助手，请用中文回答。" }, ...最近 20 条]` |
| `stream` | `true`（固定） |
| `max_tokens` | `min(AI_MAX_TOKENS \|\| 1024, 1024)` |
| `temperature` | `env.AI_TEMPERATURE`（默认 0.7；`.env.example` 示例为 0.3） |
| `top_p` | `env.AI_TOP_P`（默认 0.9；`.env.example` 示例为 0.8） |

请求头包含 `Authorization: Bearer ${SILICONFLOW_API_KEY}` 与 `Accept-Encoding: identity`（避免上游压缩破坏逐块到达节奏）。

上游返回的每个 SSE 行由 `StreamProcessor` 解析为 `choices[0].delta.content`；`parsed.error` 会被当作特殊 token 推给业务层并终止解析。

## 5. 超时与取消

| 层级 | 阈值 | 位置 | 行为 |
|---|---|---|---|
| Vercel 函数上限 | 60s | `app/api/chat/route.ts` 的 `export const maxDuration = 60` | 函数被平台终止 |
| 服务端首字节 | 60s（`AI_FIRST_BYTE_TIMEOUT_MS`） | 同文件 | 主动 `abortController.abort()` |
| 客户端整体 | 120s | `hooks/useChatStream.ts` | `controller.abort()` + 追加 `[生成超时]` |

取消链路必须逐级传递，任一环断开都会导致上游继续计费：

```
用户点「取消」/ 按 Esc / 关闭页面
  → 客户端 AbortController.abort()
  → request.signal 'abort'
  → 服务端 abortController.abort()
  → 上游 fetch 的 signal 触发
  → StreamProcessor.read() 抛错
  → createSSEResponse 的 onError
      ├─ 落库：accumulatedText + "\n\n[用户已中断]"
      └─ 向客户端补发 data: {"token":"\n\n[生成已中断]"}
```

用户主动取消与超时在客户端使用不同标识区分：`manualCancelRef` 标记用户意图，自定义 `AI_REPLY_TOO_LONG` 标识超长，避免把自定义中断误判为 `AbortError` 超时。

## 6. 落库时机

- **用户消息**：进入流之前由 `saveUserMessage` 立即写入，保证「用户说过的话」永不丢失。
- **AI 回复**：只在流结束时写入一次，由 `saveAiReply` 的 `savePromise` 锁 + `hasSaved` 标记保证幂等；`onComplete`、`onError`、取消三条路径共用该函数。
- **会话标题**：仅在标题为空时，用 AI 回复内容清洗换行后取前 30 字（超出追加 `...`）写入。

## 7. 契约不一致项（待收口）

| 项 | 现状 | 影响 |
|---|---|---|
| 中断事件缺 `sessionId` | `onError` 分支的载荷只有 `token` | 前端首个事件若恰好是中断事件，`onSessionCreated` 不会被触发 |
| `[DONE]` 未主动下发 | 服务端只透传 token，从未下发 `[DONE]` | 目前无害，但前端保留了对 `[DONE]` 的兼容分支 |
| 错误详情字段 | 500 返回 `detail` 与（开发环境）`stack` | 需确认生产环境不泄漏内部结构 |
| 首字节阈值未登记 | `AI_FIRST_BYTE_TIMEOUT_MS` 未出现在 `.env.example` 与部署文档 | 运维无法发现或调整该参数 |
