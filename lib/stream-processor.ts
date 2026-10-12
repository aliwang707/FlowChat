// lib/stream-processor.ts
/**
 * 专门负责处理 SSE（Server-Sent Events）流式数据的解析
 * 职责：读取响应流 → 按行切割 → 解析 JSON → 提取 token → 回调业务层
 * 与业务逻辑（如存数据库、更新 UI）完全解耦
 */
export class StreamProcessor {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder: TextDecoder;
    private onToken: (token: string) => void;      // 每收到一个有效 token 时的回调
    private onFirstByte: () => void;                // 收到第一个 token 时的回调
    private onComplete: () => void;                // 流正常结束时的回调
    private onError: (err: Error) => void;         // 解析过程出错时的回调
    private buffer: string = "";                   // 缓存不完整的行数据

    constructor(
        responseBody: ReadableStream<Uint8Array>,   // 从 fetch 拿到的 response.body
        callbacks: {
            onToken: (token: string) => void;
            onFirstByte: () => void;
            onComplete: () => void;
            onError: (err: Error) => void;
        }
    ) {
        this.reader = responseBody.getReader();
        this.decoder = new TextDecoder();
        this.onToken = callbacks.onToken;
        this.onFirstByte = callbacks.onFirstByte;
        this.onComplete = callbacks.onComplete;
        this.onError = callbacks.onError;
    }

    /**
     * 核心方法：启动流式解析
     * 外部只需调用一次 processor.process()，解析结果通过回调返回
     */
    async process(): Promise<void> {
        let isFirstToken = true;

        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) break;

                // 1. 解码二进制数据，拼接到 buffer 末尾
                this.buffer += this.decoder.decode(value, { stream: true });

                // 2. 按换行分割
                const lines = this.buffer.split("\n");
                // 最后一行可能不完整（被截断），保留到下次拼接
                this.buffer = lines.pop() || "";

                // 3. 逐行解析
                for (const line of lines) {
                    this.processLine(line, isFirstToken, (firstFlag) => {
                        isFirstToken = firstFlag;
                    });
                }
            }

            // 4. 流结束后，处理 buffer 中剩余的可能完整的行
            if (this.buffer) {
                const tailLines = this.buffer.split("\n");
                for (const line of tailLines) {
                    this.processLine(line, isFirstToken, (firstFlag) => {
                        isFirstToken = firstFlag;
                    });
                }
            }

            // 5. 全部处理完毕，触发完成回调
            this.onComplete();
        } catch (err: any) {
            // 捕获解析过程中的任何异常（如 reader.read() 被取消）
            this.onError(err);
        }
    }

    /**
     * 处理单行数据
     */
    private processLine(
        line: string,
        isFirstToken: boolean,
        updateFirstToken: (flag: boolean) => void
    ): void {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;

        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === "[DONE]") return;

        try {
            const parsed = JSON.parse(jsonStr);

            // 情况 A：AI 返回了业务错误（如 Key 失效）
            if (parsed.error) {
                const errorMsg = parsed.error.message || "未知错误";
                // 把错误当做一个特殊的 token 推给业务层
                this.onToken(`AI 服务错误: ${errorMsg}`);
                // 抛错终止后续解析
                throw new Error(`AI 返回错误: ${errorMsg}`);
            }

            // 情况 B：正常 token
            if (!parsed.choices || parsed.choices.length === 0) return;
            const content = parsed.choices[0]?.delta?.content || "";
            if (!content) return;

            // 首次收到有效 token 时触发回调
            if (isFirstToken) {
                this.onFirstByte();
                updateFirstToken(false);
            }

            // 将 token 推给业务层
            this.onToken(content);
        } catch (parseError) {
            // 忽略无法解析的 JSON（可能是不完整的 chunk 边界）
            console.warn("JSON 解析失败，原始数据:", jsonStr);
            // 如果是我们主动抛出的 AI 业务错误，向上传递
            if (parseError instanceof Error && parseError.message.startsWith("AI 返回错误")) {
                throw parseError;
            }
        }
    }
}