# dsh-tui-app — DeepSeek Harness 终端主界面

一个基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLI）的 dsh profile 插件：
Claude Code 形态的交互式终端聊天 UI，带 DeepSeek 品牌鲸鱼 splash。

> 官方 pi-tui 框架已随上游移除（npm 上仅为占位包），本插件以 Ink 7 重建，
> 事件流直接订阅 dsh agent 的 `session/event`，进程内实时渲染。

## 特性

- 🐋 **DeepSeek 鲸鱼 splash**（官方 logo 形状 + 品牌蓝 #4D6BFE，每次启动显示）
- 💬 流式对话：用户消息 / 助手回复（推理+正文分色）/ **工具卡片**（彩色头 + 凹进体）
- ⌨️ 输入：多行（shift+enter）、中文 IME、vim 模式（esc）、`/` 命令补全、`@文件` 补全
- 🎴 **Ctrl+O 三态折叠**：工具卡片 折叠 / 展开 / 隐藏
- 📊 底部状态栏：模型 · git 分支 · 后台任务数 · 工作区
- 🔁 会话管理：`/resume`（跨工作区）+ 自动标题 + `/sessions` + **多会话 tab**
- 🌐 **A2A 派活**：`@hermes/@claude/@codex/@dsh 任务` → 结果卡片（一个终端指挥全家）
- 🛡 无环境依赖：profile 自带 sandbox 覆盖（danger-full-access），本机无 bubblewrap 也能跑 bash
- 📟 非 TTY 回退：管道 / CI 下自动降级为纯文本模式

## 安装

前置：dsh ≥ 0.1.0-rc.6、Node ≥ 22（含 corepack/pnpm）。

```bash
# 1. 建 profile（若还没有）
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
cat > package.json <<'EOF'
{
  "name": "dsh-profile-tui",
  "private": true,
  "dependencies": {
    "dsh-tui-app": "github:kouyichi/dsh-tui-app"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base"]
    }
  }
}
EOF
printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > pnpm-workspace.yaml

# 2. 装依赖
corepack pnpm install

# 3. 写 profile patch 层（注入插件行 + 沙箱覆盖）
cat > cordis.patch.yml <<'EOF'
- id: system-prompt
  config:
    persona: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
- id: hmr
  disabled: true
- id: sandbox-policy
  config:
    mode: danger-full-access
    workspaceRoot: !!js process.cwd()
- id: approval
  config:
    policy: never
- insert:
    - id: tui-startup
      name: 'dsh-tui-app/startup'
    - id: tui-runner
      name: 'dsh-tui-app'
      inject: [tuiStartup]
      config:
        sessionId: !!js ctx.tuiStartup.sessionId
EOF
```

> 或开发模式：`git clone https://github.com/kouyichi/dsh-tui-app ~/.dsh/profiles/tui/plugins/dsh-tui-app`
> 并把 package.json 依赖改为 `"dsh-tui-app": "file:./plugins/dsh-tui-app"`。

## 使用

```bash
dsh --profile tui                          # 新会话
dsh --profile tui --resume <sessionId>     # 续聊（带完整记忆）
```

### 斜杠命令

| 命令 | 作用 |
|---|---|
| `/help` | 帮助 |
| `/quit` `/exit` | 退出 |
| `/config` | 状态栏统计开关（空格切换，持久化） |
| `/mode` | Agent 模式：标准/PTC/极简/创造（新会话生效） |
| `/model` | 模型选择器（列表 + 推理力度 e 切换） |
| `/jobs` | 后台任务面板（空格日志 · k 停止） |
| `/search <词>` | 会话全文搜索（FTS） |
| `/trajectory` | 事件轨迹步进回放 |
| `/feedback up|down [备注]` | 消息反馈（落盘 feedback.json） |
| `/tab new \| /tab <n>` | 多会话 tab（PgUp/PgDn 循环切换） |
| `/agents` | A2A 端点探测（hermes/claude/codex/dsh） |
| `/resume` `/sessions` `/compact` `/plan` `/goal` | 会话/压缩/模式入口 |

### 快捷键

| 键 | 作用 |
|---|---|
| Enter | 提交 |
| shift+Enter | 换行（多行输入） |
| Esc | vim 模式开关（h/l/0/$/x/i/a） |
| Tab | 补全：`/命令` / `@文件` |
| Ctrl+O | 工具卡片折叠三态循环 |
| PgUp/PgDn | 循环切换会话 tab |
| Ctrl+C | 空闲=退出；回复中=中断当前轮 |
| Ctrl+D | 空行退出 |

## 架构

```
dsh-tui-app (cordis 插件, 纯 Node ESM, 零构建)
├── lib/index.js            入口：agent 驱动（create/resume + followup + flush）
├── lib/startup.js          解析 --resume/--help，发布 tuiStartup 服务
├── lib/runtime/
│   ├── app.js              Ink 组件树（splash/流/状态栏/输入行）
│   ├── input.js            自定义 raw-mode 输入层（IME/粘贴/vim/CSI 解析）
│   ├── store.js            useSyncExternalStore 外部状态
│   └── text-mode.js        非 TTY 回退渲染
├── lib/channel/events.js   session/event 归一化 → React 事件流
├── lib/components/         splash / message-stream / tool-card / status-bar / input-box
├── lib/theme/palette.js    唯一 SGR 来源（品牌蓝 #4D6BFE 语义角色）
└── test/                   node:test 单测（input + palette/channel）
```

关键点：**TUI 是薄界面**——agent/会话/工具全部来自 `@deepseek-ai/dsh-base`；
`agent.ctx.on("session/event")` 是唯一数据源，不落盘、不复制逻辑。

## 开发

```bash
node --test test/input.test.js test/palette-events.test.js   # 单测（node 22 需显式文件）
printf '你好\n/quit\n' | timeout 60 script -qec "dsh --profile tui" /dev/null  # 真机冒烟
```



## 许可

MIT（DeepSeek 标志归 DeepSeek 所有；本项目为独立非官方插件）
