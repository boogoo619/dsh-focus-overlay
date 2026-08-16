# dsh-focus-overlay

为 DeepSeek Harness（DSH）Web GUI 提供的**专注模式**插件：一键进入全屏阅读视图，隐藏标题区与输入区，把 AI 的工具调用流程折叠成一句话摘要，只保留"你与 AI 的对话"本身。文本与图片渲染直接复用官方的 `@deepseek-ai/dsh-client-ui-primitives` 原语，与聊天视图 1:1 一致。

这是一个 **bundle 插件**（区别于会话内临时动态插件），能 `import` 官方 Markdown 渲染器、解析会话授权图片，并持久化设置。

## 特性

- **全屏专注遮罩**：通过 `shell.overlay` 注册（纯增量，绝不替换/遮挡自带 UI 的数据），覆盖整个界面，纵向空间全留给对话。
- **官方渲染**：AI 文本走官方 `MarkdownText`（GFM + 代码高亮 + TeX），用户消息走 `MessageText`，图片走 `conversation.resolveImage`。
- **工具调用折叠**：工具调用 / 命令 / 上下文注入折叠成分类摘要行（"运行了 2 个命令，编辑了 3 个文件，读取了 5 个文件…"）。
- **精确保留滚动位置**：进入专注时定位到聊天视图中当前正在阅读的消息，而非从头开始。
- **右侧节点导航条**：每个 user 消息一个圆点，激活药丸跟随滚动、悬停预览、点击跳转。
- **回到最新**：离开底部时显示居中的"↓ 回到最新"悬浮按钮。
- **i18n**：中 / 英文案，跟随界面语言。
- **设置页**：显示导航条、打开时保留位置、文字区宽度（可拖滑块），持久化到 `localStorage`。

## 安装

需要 `dsh` CLI（`>= 0.1.0-rc.5`）。

### 从 npm

```sh
dsh plugin --profile web add dsh-focus-overlay
dsh web
```

### 从 GitHub

```sh
dsh plugin --profile web add github:boogoo619/dsh-focus-overlay
dsh web
```

> 从 git 安装会拉取**源码**并由 `prepare` 脚本现场构建。pnpm ≥10 会先拒绝运行 `prepare`，首次 `add` 失败后，按 `dsh` 提示把包键复制进该 profile 的 `pnpm-workspace.yaml` 授权：
>
> ```yaml
> allowBuilds:
>   dsh-focus-overlay: true
> ```
>
> 然后重新执行 `add`。**这项授权意味着允许本包代码在你的机器上于安装时执行**——请只对可信来源授权，并用 commit 锁定（`github:boogoo619/dsh-focus-overlay#<sha>`）。

### 从本地目录 / tarball

```sh
# 本地目录（开发）
dsh plugin --profile web add ./dsh-focus-overlay

# tarball（npm pack 产物）
dsh plugin --profile web add ./dsh-focus-overlay-0.1.0.tgz
```

安装后重启 `dsh web` 生效。

## 使用

1. 打开任意会话，点击标题栏操作区的 **「专注」** 按钮。
2. 进入全屏专注视图：顶部只有一条极窄栏（会话标题 + 退出），正文只显示你与 AI 的对话，工具步骤折叠为摘要行。
3. 右侧的导航圆点可悬停预览、点击跳转；离开底部时右下出现居中的"↓ 回到最新"。
4. 按 `Esc` 或点「退出专注」返回原界面，原位置/状态保持不变。

## 设置

侧栏「设置 → 专注模式」：

| 选项 | 说明 |
|---|---|
| 显示右侧导航条 | 开关导航圆点（默认开） |
| 打开时保留聊天位置 | 进入专注时定位到当前阅读位置，关闭则定位到最新（默认开） |
| 文字区宽度 | 480–1200px 滑块，调整阅读列宽（默认 760px） |

## 构建与开发

```sh
npm install
npm run build   # 产出 lib/index.mjs（Node half）+ lib/client.js（浏览器 bundle）
```

构建产物 `lib/` 不入库；npm 发布与 git 安装时由 `prepare` 脚本现场构建。

## 目录结构

```
src/index.mjs            Node half（空 apply）
src/client/index.ts      client apply：注入样式、注册 overlay / 按钮 / 设置页
src/client/FocusView.tsx 核心组件（MarkdownText/MessageText、图片、摘要、导航条）
src/client/styles.ts     包内样式（仅 --dsw-* token）
src/client/settings.ts   偏好（localStorage）
src/client/locales.ts    中/英词典
cordis.patch.yml         组合层补丁
tsdown.config.ts         双 half 构建（Node ESM + 浏览器 __ModuleLoader__ CJS）
```

## License

[MIT](./LICENSE)
