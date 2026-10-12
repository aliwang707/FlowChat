/**
 * 处理聊天请求，串联身份认证、参数校验、AI 流式调用和数据库持久化
 * 技术关键词: Next.js App Router, Server-Sent Events (SSE), ReadableStream, Zod, Supabase
 */
import { env, supabase } from "@/lib/supabase";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { fetchAIResponse } from "@/lib/ai-service";
import { insertAssistantMessage, tryUpdateSessionTitle, saveUserMessage } from "@/lib/session-helpers";
import { createSSEResponse } from "@/lib/sse-response";

// 首字节超时阈值（从环境变量读取，默认 60 秒）
const FIRST_BYTE_TIMEOUT = Number(process.env.AI_FIRST_BYTE_TIMEOUT_MS || 60000);

// Vercel 函数最大执行时长（60 秒，与超时阈值对齐）
export const maxDuration = 60;

// 限制 AI 最大生成 token 数，防止回复过长导致 Vercel 函数超时
// 同时将硬编码的 1024 提取为常量，便于统一调整
const MAX_TOKENS_LIMIT = Math.min(env.AI_MAX_TOKENS || 1024, 1024); 

export async function POST(request: NextRequest) {
  // 超时定时器句柄，用于清理
  let firstByteTimeoutId: NodeJS.Timeout | null = null;

  // 统一清理超时定时器（避免重复调用）
  const clearFirstByteTimeout = () => {
    if (firstByteTimeoutId) {
      clearTimeout(firstByteTimeoutId);
      firstByteTimeoutId = null;
    }
  };

  try {
    // ----- 1. 身份认证（Clerk）-----
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    // ----- 2. 限流检查（防刷）-----
    // 基于内存 Map 的滑动窗口限流，单实例有效
    if (!rateLimit(userId)) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
    }

    // ----- 3. 解析请求体 -----
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON请求格式错误" }, { status: 400 });
    }

    // ----- 4. Zod 参数校验（双重保险）-----
    // 使用 safeParse 避免 try-catch，校验失败时直接返回 400。
    // 双重保险：前端 TS 类型 + 后端 Zod Schema，防止脏数据进入业务逻辑。
    const validation = ChatRequestSchema.safeParse(rawBody);
    if (!validation.success) {
      // 将所有校验错误拼成一条可读字符串，方便调试
      const errorMsg = validation.error.issues
        .map((i) => `${i.path.join(".")}:${i.message}`)
        .join("; ");
      return NextResponse.json({ error: `请求参数校验失败：${errorMsg}` }, { status: 400 });
    }

    // ----- 5. 提取核心数据 -----
    const { messages, sessionId } = validation.data;
    //获取最后一条消息，确保是用户发的
    const userMessage = messages.at(-1);
    // 只带最近 20 条上下文，防止 token 超限
    const recentMessages = messages.slice(-20);

    // 安全兜底：确保最后一条消息确实是用户发的（防伪造请求）
    if (userMessage?.role !== "user") {
      return NextResponse.json({ error: "最后一条消息必须来自用户" }, { status: 400 });
    }

    // ----- 6. 会话管理（创建 / 归属校验）-----
    let activeSessionId = await resolveSession(userId, sessionId);

    // ----- 7. 保存用户消息到数据库 -----
    await saveUserMessage(activeSessionId, userMessage.content);

    // ----- 8. 准备流式处理上下文 -----
    const abortController = new AbortController(); // 用于取消AI请求
    let fullAiReply = "";// 累积完整回复内容，用于最后存库
    let hasSaved = false;// 防止已保存后重复调用
    let savePromise: Promise<void> | null = null;//防止并发插入
    const sessionIdForSave = activeSessionId;

    // ----- 9. 首字节超时定时器 -----
    // 如果 AI 接口 60 秒没返回第一个 token，主动中断
    firstByteTimeoutId = setTimeout(() => {
      console.warn("首字节超时，终止请求");
      clearFirstByteTimeout();
      abortController.abort();
    }, FIRST_BYTE_TIMEOUT);

    // ----- 10. 监听客户端取消（用户点取消 / 关闭页面）-----
    request.signal.addEventListener("abort", () => {
      clearFirstByteTimeout();
      abortController.abort();
      // 如果已有内容，追加中断标记，告知用户内容被截断
      if (fullAiReply) {
        fullAiReply += "\n\n[用户已中断]";
      }
    });

    // ----- 11. 调用 SiliconFlow AI 接口 -----
    let response;
    try {
      const aiMessages = [
        { role: "system", content: "你是一个专业、友好的AI助手，请用中文回答。" },
        ...recentMessages,
      ];
      response = await fetchAIResponse({
        messages: aiMessages,
        signal: abortController.signal,
        maxTokens: MAX_TOKENS_LIMIT,
      });
    } catch (fetchError: any) {
      clearFirstByteTimeout();
      console.error("AI 服务网络错误:", fetchError);
      return NextResponse.json({ error: "AI 服务网络错误" }, { status: 502 });
    }

    // ----- 12. 检查 AI 响应状态 -----
    if (!response.ok) {
      clearFirstByteTimeout();
      const errorText = await response.text();
      console.error(`AI 服务返回错误 ${response.status}，详情已脱敏`);
      if (process.env.NODE_ENV === "development") console.error(errorText.slice(0, 200));//开发环境打印 AI 接口原始报错（限制长度），生产环境隐藏，用于调试同时保护信息。
      return NextResponse.json({ error: `AI 服务暂时不可用 (${response.status})` }, { status: 502 });
    }

    // 防止 response.body 为 null，提前返回（TS 类型收窄）
    if (!response.body) {
      clearFirstByteTimeout();
      return NextResponse.json({ error: "无法获取响应流" }, { status: 502 });
    }

    const responseBody = response.body; // 此处的类型已收窄为非 null


    //----- 13. 带锁的保存函数（防竞态重复插入） -----
    // 场景：start 正常结束、catch 异常、cancel 回调都可能触发保存
    // 用 savePromise 作为“锁”，只让第一次调用执行，后续复用
    //防止并发插入导致数据重复。
    const saveAiReply = () => {
      if (hasSaved || !fullAiReply || !sessionIdForSave) return;
      // 条件过滤：已存 / 无内容 / 无会话ID → 直接返回

      // 核心防竞态：如果已有正在执行的保存任务，直接复用
      savePromise ??= (async () => {
        try {
          // 1. 存 AI 回复到数据库
          await insertAssistantMessage(sessionIdForSave, fullAiReply);
          // 2. 如果标题为空，自动生成标题
          await tryUpdateSessionTitle(sessionIdForSave, fullAiReply);
          hasSaved = true; // 标记已存
        } catch (saveError) {
          console.error("保存AI消息抛出异常:", saveError);
        } finally {
          savePromise = null;// 解锁，允许下次保存
        }
      })();

      return savePromise;
    };

    // ----- 14. 创建 SSE 流并返回响应 ----
    return createSSEResponse({
      responseBody,
      sessionId: sessionIdForSave,
      saveAiReply,
      clearFirstByteTimeout,
    });
  }catch (error: any) {
    // ----- 15. 全局异常兜底 -----
    clearFirstByteTimeout();
    if (error.name === "AbortError") {
      return NextResponse.json({ error: "请求超时或被取消" }, { status: 408 });
    }
    console.error("未捕获的异常:", error);
    console.error("堆栈:", error.stack);
    return NextResponse.json(
      {
        error: "服务器内部错误",
        detail: error.message,
        // 仅在开发环境返回堆栈，生产环境隐藏
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

    

/**
 * 辅助函数：会话解析（获取或创建）
 * 逻辑：无 sessionId → 新建；有 sessionId → 校验归属 + 更新时间
 */
async function resolveSession(
  userId: string,
  sessionId?: string
): Promise<string> {
  if (!sessionId) {
    // 新建会话
    const { data: newSession, error } = await supabase
      .from("sessions")
      .insert([{ user_id: userId, title: null, updated_at: new Date().toISOString() }])
      .select("id")
      .single();
    if (error || !newSession) {
      console.error("创建会话失败:", error);
      throw new Error("创建会话失败");
    }
    return newSession.id;
  }

  // 校验归属
  const { data: sessionCheck, error: checkErr } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  if (checkErr || !sessionCheck) {
    throw new Error("会话不存在或无权访问");
  }

  // 更新时间（侧边栏排序用）
  const { error: updateError } = await supabase
    .from("sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (updateError) console.error("更新会话时间失败:", updateError);

  return sessionId;
}