<h1 align="center">dsh-focus-overlay</h1>

<p align="center">中文 | <a href="README.en.md">English</a></p>

<p align="center">
  为 DeepSeek Harness（DSH）Web GUI 提供的<b>专注模式</b>：一键全屏阅读，隐藏标题区与输入区，把 AI 的工具调用流程折叠成一句话摘要，只保留「你与 AI 的对话」本身。<br>
  文本与图片渲染复用官方原语，与聊天视图 1:1 一致。
</p>

<p align="center">
  <img src="https://badgen.net/npm/v/dsh-focus-overlay" alt="npm version">
  <img src="https://badgen.net/badge/license/MIT/green" alt="license">
  <img src="https://badgen.net/badge/dsh/%3E%3D0.1.0-rc.5/blue" alt="dsh version">
</p>

## 效果

**关闭 —— 普通聊天视图**

![关闭：普通聊天视图](screenshots/before.png)

**开启 —— 专注模式**

![开启：专注模式](screenshots/after.png)

<!-- 截图请放到 screenshots/ 目录：
     - before.png —— 普通聊天视图（含标题区/输入区/工具卡）
     - after.png  —— 专注模式（全屏遮罩 + 摘要行 + 右侧导航条）
     可再补一张 navbar.png 作为导航条特写。 -->

进入专注后，一轮 AI 回复不再逐个展示步骤，而是折叠成一行摘要：

> 运行了 2 个命令，编辑了 3 个文件，读取了 5 个文件，搜索了 1 个正则

## 能力

| 功能 | 说明 |
| --- | --- |
| 全屏专注遮罩 | 经 `shell.overlay` 注册（纯增量、`replaceRisk: none`），覆盖标题区/输入区/侧栏，纵向空间尽给对话 |
| 官方渲染 | AI 文本走官方 `MarkdownText`（GFM + 代码高亮 + TeX），用户消息走 `MessageText`，用户气泡用官方蓝底无描边样式 |
| 图片解析 | assistant 的 `image` 块经 `conversation.resolveImage` 解析，会话授权图片 1:1 显示 |
| 工具调用折叠 | 工具调用 / 命令 / 上下文注入按类型计数折叠成摘要行（命令/编辑/搜索/读取/列目录/子代理/待办/目标/工作流/技能/提问/计划/后台任务） |
| 精确保留位置 | 进入专注时定位到聊天视图中正在阅读的消息（按 `seq` 对齐），而非从头开始 |
| 右侧节点导航条 | 每个 user 消息一个圆点，激活药丸跟随滚动、悬停预览、点击平滑跳转，少于 2 条自动隐藏 |
| 回到最新 | 离开底部时显示居中的「↓ 回到最新」悬浮按钮 |
| 文件提及 | 接 `chatFileMentions`，内联代码命中真实文件时变成可点链接 |
| i18n | 中 / 英文案，跟随界面语言 |
| 设置页 | 导航条开关、打开定位策略、文字区宽度，持久化到 `localStorage` |

## 为什么是全屏遮罩，而不是改聊天视图

聊天视图的标题区、输入区、工具卡都是被自带 UI 占用的 slot：插件无法细粒度替换它们，也拿不到聊天视图的渲染器来复用——这正是 `dsh-focus-chat` 另起独立标签页的原因。

本插件换一条路：用一个**全屏 `shell.overlay`** 覆盖整个界面，把「隐藏标题/输入区」和「折叠工具调用」都交给自己的渲染面完成。这样既不触碰自带 DOM，又能彻底控制显示内容，还顺带解决了"精确保留聊天滚动位置"（bundle 插件有完整 DOM 访问权，可按 `seq` 对齐到同一条消息）。

## 安装

需要 `dsh` CLI（`>= 0.1.0-rc.5`）。

**从 npm（推荐）**

```sh
dsh plugin --profile web add dsh-focus-overlay
dsh web
```

**从 GitHub**

```sh
dsh plugin --profile web add github:boogoo619/dsh-focus-overlay
dsh web
```

> git 安装拉取**源码**并由 `prepare` 脚本现场构建。pnpm ≥10 会先拒绝运行 `prepare`，首次 `add` 失败后，按 `dsh` 提示把包键复制进该 profile 的 `pnpm-workspace.yaml`：
>
> ```yaml
> allowBuilds:
>   dsh-focus-overlay: true
> ```
>
> 然后重新执行 `add`。**该授权允许本包代码在安装时于你的机器上执行**——请只对可信来源授权，并锁定 commit（`github:boogoo619/dsh-focus-overlay#<sha>`）。

**本地目录 / tarball**

```sh
dsh plugin --profile web add ./dsh-focus-overlay                  # 本地目录
dsh plugin --profile web add ./dsh-focus-overlay-0.1.0.tgz        # tarball
```

安装后重启 `dsh web` 生效。

## 使用

1. 打开任意会话，点击标题栏操作区的 **「专注」** 按钮。
2. 进入全屏专注视图：顶部只有一条极窄栏（会话标题 + 退出），正文只显示你与 AI 的对话，工具步骤折叠为摘要行。
3. 右侧导航圆点可悬停预览、点击跳转；离开底部时右下出现居中的「↓ 回到最新」。
4. 按 `Esc` 或点「退出专注」返回原界面，原位置/状态保持不变。

## 设置

侧栏「设置 → 专注模式」：

| 选项 | 说明 |
| --- | --- |
| 显示右侧导航条 | 开关导航圆点（默认开） |
| 打开时保留聊天位置 | 进入时定位到当前阅读位置；关闭则定位到最新（默认开） |
| 文字区宽度 | 480–1200px 滑块，调整阅读列宽（默认 760px） |

## 开发

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

## 许可

[MIT](./LICENSE)
