/**
 * 会话相关的数据库操作（数据层）
 * 职责：存消息、更新会话标题，与 Next.js 路由解耦
 */
import { supabase } from "./supabase";

/**
 * 保存 AI 回复消息到数据库
 * @param sessionId - 当前会话 ID
 * @param content - AI 的完整回复内容
 * @throws {Error} 数据库插入失败时抛出
 */
export async function insertAssistantMessage(sessionId: string, content: string) {
  const { error } = await supabase
    .from("messages")
    .insert([{ session_id: sessionId, role: "assistant", content }]);

  if (error) {
    console.error("保存AI消息失败:", error);
    throw new Error(`保存AI消息失败: ${error.message}`);
  }
}

/**
 * 如果会话还没有标题，用 AI 回复前 30 个字自动生成标题
 * @param sessionId - 当前会话 ID
 * @param content - AI 的完整回复内容
 */
export async function tryUpdateSessionTitle(sessionId: string, content: string) {
  try {
    // 1. 检查当前会话是否有标题
    const { data: sessionData, error: fetchError } = await supabase
      .from("sessions")
      .select("title")
      .eq("id", sessionId)
      .single();

    // 如果有错误、没查到数据、或者已经有标题 → 直接返回
    if (fetchError || !sessionData || sessionData.title) {
      return;
    }

    // 2. 没有标题：生成新标题（取前 30 个字，去掉换行）
    const summary = content.replace(/\n/g, " ").slice(0, 30) + (content.length > 30 ? "..." : "");

    // 3. 更新数据库
    const { error: updateError } = await supabase
      .from("sessions")
      .update({ title: summary })
      .eq("id", sessionId);

    if (updateError) {
      console.error("更新会话标题失败:", updateError);
    }
  } catch (titleError) {
    console.error("更新标题异常:", titleError);
  }
}

/**
 * 保存用户消息到数据库
 */
export async function saveUserMessage(sessionId: string, content: string) {
  const { error } = await supabase
    .from("messages")
    .insert([{ session_id: sessionId, role: "user", content }]);
  if (error) {
    console.error("保存用户消息失败:", error);
    throw new Error("保存用户消息失败");
  }
}