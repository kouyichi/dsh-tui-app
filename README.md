<div align="center">

# 🐋 dsh-tui-app

**DeepSeek Harness 的终端主界面 —— 一条蓝鲸，指挥全家**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4D6BFE)
![node](https://img.shields.io/badge/node-%3E%3D22-339933)

一个基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLI，Claude Code 同款技术栈）的
dsh profile 插件：Claude Code 形态的交互式终端界面，DeepSeek 品牌鲸鱼，
**一个终端同时指挥 hermes / claude / codex / dsh 四个 Agent**。

</div>

## ✨ 界面预览

```
██████╗ ███████╗ ██╗  ██╗                                  ▄▄▄▄▄        ██
██╔══██╗ ██╔════╝ ██║  ██║                  ▄▄▄▄▄▄▄▄▄▄▄▄██████▀        ████
██║  ██║ ███████╗ ███████║               ▄████████████████████         ██████▄▄
██║  ██║ ╚════██║ ██╔══██║             ████████████████████████▄       ▀███████▄
██████╔╝ ███████║ ██║  ██║           ▄████████████████████████████▄     ██████████
╚═════╝ ╚══════╝ ╚═╝  ╚═╝           ████████████████████████████████▄    ▀██████▀
╭───────────────────────────────╮    ████▀▀▀▀▀▀████████████████████████▄  ▄█████
│  DeepSeek Harness            │    ████     ▀▀██████████████▀▀▀▀██████████████
│  model     deepseek-v4-flash │    ████         ▀████████████▄▄  ▀████████████
│  mode      标准模式           │    ████▄           ▀████████  █    ███▀██████
│  session   session-41bbb…    │     █████             ▀██████   ▀█▄▄ ▀███████▀
│  stats     skills 15 · pl 92 │      ██████▄      ▄▄▄       ▄  ▄█████████▀
│  /help · /config · /quit     │       ▀██████▄▄  ██████▄▄▀   ▀█████████▄▄
╰───────────────────────────────╯           ▀███████████████▄▄▄▄▄███████████
```

## 🎯 为什么用它

- 🐋 **DeepSeek 品牌鲸鱼开屏**：figlet 大标题 + 官方 logo 形状鲸鱼（品牌蓝 #4D6BFE），Hermes 式并排布局
- 🌐 **A2A 派活**：输入 `@hermes 帮我查…` / `@codex 修个 bug` —— 一个终端指挥本机全部 Agent，结果卡片化返回
- 📊 **实时统计**：轮次/步数、LLM 时间、工具时间、**缓存命中率**、TPS、token 总量，`/config` 空格开关
- 🎭 **四种模式**：标准 / PTC / 极简 / 创造 —— 与 web 同款设置，`/mode` 切换
- 📝 **Markdown 渲染**：标题、列表、引用、代码、粗体斜体直接可视化
- 🔍 **全文搜索**：SQLite FTS 索引全部会话，`/search` 秒级定位历史
- 🎬 **轨迹回放**：`/trajectory` 逐步回看每一步思考与工具调用
- 📑 **多会话 Tab**：`/tab new` 或 PgUp/PgDn 热切换，每会话独立记忆
- 🛠 完整工具面：后台任务面板、ask_user_question 浮层、plan 审批流、goal 状态、消息反馈
- ⌨️ 中文 IME、vim 模式、多行输入、命令联想、`@文件` 补全、历史浏览

## 🚀 快速开始

前置：dsh ≥ 0.1.0-rc.6、Node ≥ 22（含 corepack/pnpm）。

```bash
# 1. 建 profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
cat > package.json <<'EOF'
{
  "name": "dsh-profile-tui",
  "private": true,
  "dependencies": {
    "dsh-tui-app": "github:kouyichi/dsh-tui-app"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base"] } }
}
EOF
printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' > pnpm-workspace.yaml

# 2. 装依赖
corepack pnpm install

# 3. 写 profile patch（注入插件行 + 沙箱 + 搜索索引，见 README 完整版）
cat > cordis.patch.yml <<'EOF'
- id: system-prompt
  config:
    persona: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
- id: hmr
  disabled: true
- id: sandbox-policy
  config: { mode: danger-full-access, workspaceRoot: !!js process.cwd() }
- id: approval
  config: { policy: never }
- id: web-search-deepseek
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: http://127.0.0.1:8899/anthropic/v1
- insert:
    - id: tui-startup
      name: 'dsh-tui-app/startup'
    - id: session-stats
      name: '@deepseek-ai/dsh-session-stats'
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config: { default: standard }
    - id: tui-runner
      name: 'dsh-tui-app'
      inject: [tuiStartup]
      config: { sessionId: !!js ctx.tuiStartup.sessionId }
EOF

# 4. 启动
dsh --profile tui
```

## ⌨️ 命令与快捷键

| 命令 | 作用 |
|---|---|
| `/mode` | Agent 模式：标准 / PTC / 极简 / 创造（新会话生效） |
| `/model` | 模型选择器 + 推理力度（`e` 切换） |
| `/config` | 状态栏统计开关（空格切换，持久化） |
| `/jobs` | 后台任务面板（空格日志 · `k` 停止） |
| `/search <词>` | 会话全文搜索（FTS） |
| `/trajectory` | 事件轨迹回放 |
| `/feedback up\|down [备注]` | 消息反馈 |
| `/tab new \| /tab <n>` | 多会话 Tab |
| `/agents` | A2A 端点探测 |
| `/goal` | 目标状态（阶段/轮次/受阻原因） |
| `@hermes/@claude/@codex/@dsh <任务>` | A2A 派活 |

| 快捷键 | 作用 |
|---|---|
| Shift+Enter | 多行输入 |
| Esc | vim 模式 |
| Tab / ↑↓ | 命令联想选择 |
| ↑↓（无联想时） | 历史浏览 |
| Ctrl+O | 思考/工具卡片折叠 |
| PgUp/PgDn | 切换会话 Tab |
| Ctrl+C | 中断 / 退出 |

## 🏗 架构

```
dsh-tui-app (cordis 插件, 纯 Node ESM, 零构建)
├── lib/index.js            agent 驱动 + 会话 Tab + 菜单路由 + 统计
├── lib/runtime/            Ink 挂载 / 自定义输入层（IME·vim·粘贴）/ store
├── lib/channel/            事件归一化 + A2A 客户端（50ms 批量渲染）
├── lib/components/         splash / 消息流 / 工具卡片 / 各面板 / TabBar
├── lib/markdown.js         轻量 Markdown 渲染（零依赖）
├── lib/theme/              品牌蓝 palette（唯一 SGR 来源）
└── test/                   node:test 单测
```

核心原则：**TUI 是薄界面** —— agent/会话/工具全部来自 `@deepseek-ai/dsh-base`；
`agent.ctx.on("session/event")` 是唯一数据源，不落盘、不复制逻辑。

## 🧪 开发

```bash
node --test test/input.test.js test/palette-events.test.js   # 21 项单测
printf '你好\n/quit\n' | timeout 60 script -qec "dsh --profile tui" /dev/null  # 冒烟
```

## 📄 许可

MIT —— DeepSeek 标志归 DeepSeek 所有；本项目为独立非官方插件。
