# 流式渲染与 UI 架构

> 最后核对：2026-10-13
>
> 本文描述消息的渲染管线、Markdown 组件映射、主题与响应式策略。数据来源见[请求链路与 SSE 流式契约](请求链路与SSE流式契约.md)。

## 1. 渲染管线

```
messages[]（useChatStream）
  → MessageList 逐条渲染气泡
      ├─ content === ''  → TypingDots（三点动画 + 思考中）
      ├─ 流式进行中      → StreamingMarkdown（isLoading 透传）
      └─ 已完成          → StreamingMarkdown
  → StreamingMarkdown
      ├─ cleanMarkdown：折叠 `>>` 等异常引用标记
      └─ ReactMarkdown + remark-gfm + rehype-raw
            └─ 自定义组件映射：code / pre / p / table 族
```

- `messages` 数组是 UI 的唯一真相，任何渲染变化都必须先改数组。
- 空数组且 `loadingMessages` 时展示「加载历史消息中...」；空数组且非加载时展示 `EmptyState`。
- 容器使用 `role="log"` + `aria-live="polite"`，让屏幕阅读器播报新增消息。

## 2. 气泡与角色语义

| 角色 | 样式 | 备注 |
|---|---|---|
| `user` | 蓝色实心、右上角小圆角、右对齐 | 无头像 |
| `assistant` | 灰底、左上角小圆角、左对齐 | 前置 🤖 圆形头像 |
| `system` | 红色浅底、左上角小圆角、左对齐 | 用于取消等系统提示 |

复制按钮：`user` 与 `assistant` 消息在非加载、非错误状态下显示；移动端常显，桌面端 `group-hover` 显隐。

## 3. Markdown 组件映射

| Markdown 元素 | 实现 | 关键行为 |
|---|---|---|
| 围栏代码块（有 `language-`） | `SyntaxHighlighter`（Prism） | 按主题切换 `oneLight` / `oneDark`，右上角复制按钮 |
| 行内代码 / 无语言围栏 | `<code>` | 灰底圆角，支持长词断行 |
| `pre` | 包一层 `overflow-x-auto` div | 防止长行撑破气泡 |
| 段落 | `<p class="mb-2 last:mb-0">` | 收紧段间距 |
| `table` | `TableWrapper` | 校验是否存在有效行；无有效行时降级为「（表格格式异常，已转为纯文本）」 |
| `thead` / `tbody` / `tr` / `th` / `td` | 自定义样式 | 边框、斑马纹、横向滚动容器 |

`rehype-raw` 允许原始 HTML 通过，这是 Markdown 能力“更全”与 XSS 面“更大”的取舍点，见第 6 节。

## 4. 主题

- 状态归 `hooks/useDarkMode`：初始值依次取 `localStorage.theme` → `prefers-color-scheme`。
- 切换时在 `<html>` 上增删 `dark` 类，并写回 `localStorage.theme`。
- 系统主题变化只在用户**未手动设置**（`localStorage.theme` 为空）时才跟随。
- 全站样式使用 Tailwind `dark:` 变体，因此主题切换对绝大多数组件即时生效。

**已知缺陷**：`StreamingMarkdown` 内部独立用 `matchMedia('(prefers-color-scheme: dark)')` 判断主题，不读取 `useDarkMode` 的状态。结果是：用户在系统为浅色时手动切到深色，页面变深但代码块仍是浅色主题。

## 5. 响应式与移动端

| 断点 | 行为 |
|---|---|
| `< md`（< 768px） | 顶部条显示菜单按钮与主题按钮；侧边栏变为 `fixed` 抽屉，`translate-x` 滑出，配黑色半透明遮罩 |
| `≥ md` | 侧边栏常驻左侧 256px；顶部条只保留标题与主题按钮 |

- 输入区使用 `env(safe-area-inset-bottom)` 适配刘海屏底部安全区。
- 输入框回车提交，并检查 `nativeEvent.isComposing` 以避免中文输入法选词时误提交。

## 6. 无障碍与安全

| 项 | 现状 |
|---|---|
| 消息区 | `role="log"`、`aria-live="polite"`、`aria-label="聊天消息记录"` |
| 删除弹窗 | `role="alertdialog"`、`aria-modal="true"`、`aria-labelledby` |
| 图标按钮 | 普遍带 `aria-label`（复制、打开/关闭侧边栏、关闭遮罩） |
| 主题按钮 | `aria-pressed={isDark}` |
| 输入框 | `aria-label="消息输入框"` |
| 快捷键 | `Esc` 取消生成 |
| XSS 面 | `rehype-raw` 允许原始 HTML 渲染，依赖上游模型输出可信；若面向不可信内容需加白名单 |

## 7. 已知缺口

| 缺口 | 影响 | 追踪 |
|---|---|---|
| 代码块主题不跟随手动深色切换 | 视觉不一致 | 修复方式：把 `isDark` 经 props 传入 `StreamingMarkdown` |
| `components/chat/CodeBlock.tsx` 与内部实现重复 | 维护双份逻辑 | 收敛后删除 |
| 无消息级键盘导航 | 键盘用户无法遍历消息与复制按钮 | 未排期 |
| 无「滚动到底部」按钮 | 长对话回看后难以回到最新 | 未排期 |
| 无自动重试与失败态细化 | 只显示统一错误提示 | 未排期 |
| 消息列表无虚拟滚动 | 长会话性能随消息数线性下降 | 未排期 |
