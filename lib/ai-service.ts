import { env } from "./supabase";

/**
 * 调用 SiliconFlow AI 接口（只负责发请求，不处理流）
 * @param params.messages - 发送给 AI 的消息数组（包含 system prompt 和历史）
 * @param params.signal - AbortSignal 用于取消请求
 * @param params.maxTokens - 最大输出 token 数
 * @returns Response 对象（包含 response.body 流）
 */
export async function fetchAIResponse(params: {
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  maxTokens: number;
}) {
  return fetch(`${env.SILICONFLOW_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SILICONFLOW_API_KEY}`,
      "Accept-Encoding": "identity",
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: params.messages,
      stream: true,
      max_tokens: params.maxTokens,
      temperature: env.AI_TEMPERATURE,
      top_p: env.AI_TOP_P,
    }),
    signal: params.signal,//给 fetch 绑定可手动取消的信号，支持超时、用户中断时终止 AI 流式请求。
  });
}