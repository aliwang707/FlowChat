import { StreamProcessor } from "@/lib/stream-processor";

type SSEOptions = {
  responseBody: ReadableStream<Uint8Array>;
  sessionId: string;
  saveAiReply: (aiText: string) => Promise<void> | void;  
  clearFirstByteTimeout: () => void;
};

export function createSSEResponse({
  responseBody,
  sessionId,
  saveAiReply,
  clearFirstByteTimeout,
}: SSEOptions): Response {
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      let accumulatedText = "";  

      const processor = new StreamProcessor(responseBody, {
        onFirstByte: clearFirstByteTimeout,
        onToken: (token: string) => {
          accumulatedText += token;  
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ token, sessionId })}\n\n`
            )
          );
        },
        onComplete: async () => {
          await saveAiReply(accumulatedText);  
          controller.close();
        },
        onError: async (err: Error) => {
          clearFirstByteTimeout();
          console.error("流处理错误:", err);
          // 用户中断时，accumulatedText 已有已生成内容，追加中断标记
          const textToSave = accumulatedText
            ? accumulatedText + "\n\n[用户已中断]"
            : "";
          await saveAiReply(textToSave);  
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ token: "\n\n[生成已中断]" })}\n\n`
              )
            );
            controller.close();
          } catch {
            controller.error(err);
          }
        },
      });
      await processor.process();
    },
    cancel() {
      // 取消由外部的 AbortController 控制
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    },
  });
}