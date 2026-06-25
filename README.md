# opal-mirror

把 Claude / ChatGPT / Gemini / DeepSeek / 豆包 / 千问 网页端的历史对话同步到本地 JSON 备份。

不依赖第三方服务、不导出 cookie、不暴露 token——通过 [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) 让你**已经登录的 Chrome 标签页自己调它后端的 API**，结果回传到本地。

## 推荐入口：作为 Agent Skill 使用

最适合普通用户的形态不是手敲 README 命令，而是从 skill hub 安装 `opal-mirror` skill，让 Agent 完成初始化、自检和有限数量导入。

安装 skill 后，把这句话发给 Agent：

```text
请用 $opal-mirror 初始化我的本地 Agent，上来先 bootstrap 检查环境，不要新开 Chrome profile；确认主 Chrome 和登录状态没问题后，问我要同步多少条，再把这些网页端大模型聊天记录导入 terminal Codex /resume 和 Codex App。
```

skill 包在本仓库：

```text
skill/opal-mirror
```

首次运行会：

- 自动检查 `git` 和 Node.js 18+。
- 没有本地 repo 时 clone `https://github.com/1va7/opal-mirror.git` 到 `~/.local/share/opal-mirror`。
- 运行 `npm install`。
- 只使用用户已经登录的主 Chrome profile，通过内置 CDP proxy 连接；不会创建、建议或切换到新的 `--user-data-dir`。
- `bootstrap` 成功后才询问用户同步数量，并用 bounded import 写入本地 archive / Codex `/resume`。

手动触发等价命令：

```bash
skill/opal-mirror/scripts/opal_mirror_skill.sh bootstrap chatgpt
skill/opal-mirror/scripts/opal_mirror_skill.sh import-codex-limited chatgpt 20
```

如果 Chrome 报 `DevTools remote debugging requires a non-default data directory`，skill 会停下来报错。这个版本的 Chrome/策略阻止了“已登录主 profile + CDP”的工作流；不要用新 profile 绕过。

`sync` / `import` 在 skill wrapper 里默认必须带数量限制，避免首次使用误跑全量。

## 给 Agent 的一句话（CLI 版）

把这句话发给你的 Agent：

```text
请帮我使用 https://github.com/1va7/opal-mirror 同步我的网页端大模型聊天记录；先运行 doctor，根据检查结果帮我配置环境，然后问我要同步多少条，再运行带 --limit 的 sync/import。不要新开 Chrome profile，不要上传或提交 ai-chat-archive、cookie、token、SQLite、JSONL 或浏览器配置文件。
```

如果你自己会用终端，可以先跑：

```bash
npx github:1va7/opal-mirror doctor
```

## 为什么这样做

各家 LLM 的 Web App 历史导出现状：

| 平台 | 官方导出 | 备注 |
|---|---|---|
| ChatGPT | ✅ Settings → Data Controls → Export | 异步邮件，链路长 |
| Claude | ✅ Settings → Privacy → Export | 同上 |
| Gemini | ⚠️ 通过 Google Takeout | 时延较高 |
| 国产几家（GLM / MiniMax / Kimi 等） | ❌ 全无 | 只能抓 |
| **DeepSeek / 豆包 / 千问** | ❌ 全无 | ✅ 本仓库已实现 |

**官方导出难自动化**（异步、要解析邮件链接、有时效），但 Web App 本身是普通 REST 应用——既然浏览器能加载历史，让它自己拉就好。

## 方案

```
Node 脚本 ──HTTP──▶ CDP Proxy(:3456) ──CDP──▶ Chrome ──页面内执行JS──▶ 站点API
                                                                          │
   ◀────────── JSON 结果回传 ────────────────────────────────────────────┘
```

让 `fetch()` 跑在浏览器页面上下文里——cookie/token 自动带上，跨域/CSRF 全免。

## 各平台怎么实现

| 平台 | 路线 | 端点 |
|---|---|---|
| **Claude** | 干净 REST | `GET /api/organizations/{org}/chat_conversations/{uuid}` |
| **ChatGPT** | REST + Bearer token | `GET /backend-api/conversation/{id}`（先从 `/api/auth/session` 拿 access token） |
| **Gemini** | DOM 抓取 | 没有可用 REST，逐个会话 navigate 到 `/app/{id}`，读 `<user-query>` / `<model-response>` |
| **DeepSeek** | 内部 REST + Bearer (localStorage userToken) | `GET /api/v0/chat_session/fetch_page` + `GET /api/v0/chat/history_messages` |
| **豆包** | 字节 IM 协议（POST + cmd 数字） | `POST /samantha/thread/list` + `POST /im/chain/single` (cmd 3100) |
| **千问** | 跨域 REST | `GET chat2-api.qianwen.com/api/v1/session/list` + `GET .../session/msg/list`（ut 取 `localStorage.qianwen-uniq-id`）|

## 前置条件

1. **Node.js** 18+

2. **Chrome 启动时带远程调试**

   macOS：
   ```bash
   # 完全关闭 Chrome 后再跑：
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222
   ```
   或在 `chrome://inspect/#devices` 勾选 "Allow remote debugging for this browser instance"。

3. **CDP→HTTP Proxy 服务** 跑在 `localhost:3456`

   原始 Chrome DevTools Protocol 是 WebSocket，本仓库假设有一层 HTTP 代理把它包装成 REST。必须支持以下端点：

   ```
   GET  /targets                            # 列出所有 tab
   POST /eval?target=<id>     body=<JS>     # 在 tab 里执行 JS
   GET  /new?url=<url>                      # 新建 tab
   GET  /navigate?target=<id>&url=<url>     # 导航 tab
   ```

   任何提供这些端点的实现都行，也可以用自己已有的 CDP HTTP proxy。

4. **在该 Chrome 里登录** 你想同步的平台：
   - claude.ai / chatgpt.com / gemini.google.com
   - chat.deepseek.com / www.doubao.com / www.qianwen.com

## 验证环境

```bash
npx github:1va7/opal-mirror doctor
```

逐项检查 Node 版本、CDP proxy、各平台 tab + 登录态、归档目录。出问题先看这个再排查。

## 用法

```bash
git clone https://github.com/1va7/opal-mirror.git
cd opal-mirror

# 检查环境
npx github:1va7/opal-mirror doctor
# 或本地 clone 后：
node doctor.mjs

# 全量同步所有平台（增量、跳过已存）
node sync.mjs
# 或：
npx github:1va7/opal-mirror sync

# 单独同步某家
node sync.mjs claude
node sync.mjs chatgpt
node sync.mjs gemini
node sync.mjs deepseek
node sync.mjs doubao
node sync.mjs qwen

# 生成可读的索引表（sync 后会自动跑，单独触发用这个）
node build_index.mjs

# 导入到 terminal Codex 的 /resume 列表，并生成 Codex App mirror
node export_codex.mjs chatgpt --codex-home ~/.codex
# 或：
npx github:1va7/opal-mirror export-codex chatgpt --codex-home ~/.codex --cwd ~

# 跑测试套件
node test_e2e.mjs

# 跳过自动 rebuild index
node sync.mjs --no-index
```

输出默认在脚本同级的 `ai-chat-archive/`（自包含项目目录）。改路径：

```bash
AI_CHAT_ARCHIVE_DIR=/path/to/archive node sync.mjs
```

CDP Proxy 不在 3456 端口：

```bash
CDP_PROXY=http://localhost:9999 node sync.mjs
```

## 隐私与安全

- 本仓库不要求手动复制 cookie、token 或浏览器配置文件。
- 所有站点请求都在你已经登录的 Chrome 页面上下文中执行；脚本只接收站点 API 返回的聊天 JSON。
- 默认输出目录 `ai-chat-archive/` 已被 `.gitignore` 排除，不会随代码提交。
- 生成的 Codex 导出目录包含聊天内容，也默认位于 `ai-chat-archive/` 或你指定的本地目录；公开仓库前不要提交这些目录。
- `export_codex.mjs` 会写入你指定的本地 Codex home，例如 `~/.codex`；它不会上传这些本地 session。
- 如果你要共享问题复现，请先脱敏 archive 样本里的标题、消息内容、URL、账号或组织信息。

## 输出结构

```
<repo>/ai-chat-archive/      # 默认与脚本同级，可被 AI_CHAT_ARCHIVE_DIR 覆盖
├── INDEX.md              # 可读索引（build_index.mjs 生成）
├── claude/{uuid}.json
├── chatgpt/{conversation_id}.json
├── gemini/{id}.json
├── deepseek/{session_id}.json
├── doubao/{conversation_id}.json
├── qwen/{session_id}.json
```

每家的 schema：

**Claude** — 平台原始字段，含 `chat_messages[]`：
```json
{
  "uuid": "...",
  "name": "对话标题",
  "updated_at": "2026-05-05T...",
  "chat_messages": [
    { "sender": "human", "text": "...", "created_at": "..." },
    { "sender": "assistant", "text": "...", "created_at": "..." }
  ],
  "_org": { "uuid": "...", "name": "..." }
}
```

**ChatGPT** — 平台原始字段，会话用 `mapping` 树结构：
```json
{
  "title": "...",
  "create_time": 1730000000.0,
  "update_time": 1730000000.0,
  "mapping": {
    "<node-id>": {
      "id": "...",
      "message": {
        "author": { "role": "user" },
        "content": { "content_type": "text", "parts": ["..."] }
      },
      "parent": "...",
      "children": ["..."]
    }
  }
}
```

**Gemini** — DOM 抓取后**已线性化**：
```json
{
  "id": "...",
  "title": "...",
  "url": "https://gemini.google.com/app/...",
  "synced_at": "2026-05-06T...",
  "turn_count": 4,
  "turns": [
    { "role": "user", "text": "..." },
    { "role": "model", "text": "..." }
  ]
}
```

**DeepSeek** — 平台原始字段，含 `chat_messages[]`：
```json
{
  "id": "...",
  "title": "对话标题",
  "updated_at": 1777017273.526,
  "chat_session": { ... },
  "chat_messages": [
    { "message_id": "...", "role": "USER", "content": "...", "fragments": [...] },
    { "message_id": "...", "role": "ASSISTANT", "content": "...", "search_results": [...] }
  ]
}
```

**豆包** — 字节 IM 协议消息，每条 `messages[]` 带 `content_block[]` 块结构：
```json
{
  "thread_id": "...",
  "conversation_id": "...",
  "name": "对话标题",
  "update_time": 1778074471,
  "messages": [
    {
      "message_id": "...",
      "user_type": 2,                  // 1=user, 2=assistant
      "content_block": [
        { "block_type": 10000, "content": { "text_block": { "text": "..." } } }
      ],
      "create_time": "1778074448"
    }
  ]
}
```

**千问** — 平台原始字段，会话由若干 `records[]` 组成（每个 record 是一轮交互）：
```json
{
  "session_id": "...",
  "title": "对话标题",
  "updated_at": "2026-05-08T...",
  "records": [
    {
      "req_id": "...",
      "request_messages": [{ "content": "..." }],
      "response_messages": [{ ... }],
      "model_name": "..."
    }
  ]
}
```

## 导入 Codex /resume 和 Codex App

`export_codex.mjs` 会把 web chat archive 转成两份本地 Codex mirror：

- `source=cli`：terminal Codex 的 `/resume` 列表。
- `source=vscode`：Codex App 的 sidebar/search。

这两份不是合并成同一个 thread，而是同一条 web chat 的两个本地目标副本。标题统一带 `[webchat:<platform>]`，用于和原生 Codex App 对话区分。

```bash
# 建议先退出正在运行的 terminal Codex，再导入
node export_codex.mjs all --archive ./ai-chat-archive --codex-home ~/.codex --cwd ~

# 只导入 ChatGPT
node export_codex.mjs chatgpt --codex-home ~/.codex --cwd ~

# 测试输出，不写 SQLite state
node export_codex.mjs chatgpt --codex-home /tmp/codex-test --no-state
```

它会写入：

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
~/.codex/state_5.sqlite
~/.codex/session_index.jsonl
~/.codex/history.jsonl
~/.codex/.codex-global-state.json   # Codex App sidebar registry
<archive>/_codex_app_thread_ids.json
```

这里有几个和 `/resume` 兼容相关的细节：

- `/resume` 主要读 `state_5.sqlite` 的 `threads` 表；只放 JSONL 文件不够。
- transcript 里同时写 `event_msg.user_message`、`event_msg.agent_message` 和 `response_item`，所以进入 session 后能看到用户消息和模型回复。
- SQLite 的 `created_at_ms/updated_at_ms`、rollout JSONL 的 timestamp、文件 mtime、Codex App mirror thread id 的时间前缀都用 web chat 原始发生时间；导入后不会按“刚刚导入”的时间堆到列表最前面。
- Codex App mirror 的 metadata 写入 `mirror_target=codex_app`；terminal mirror 写入 `mirror_target=terminal`。
- 重复运行是幂等的：SQLite 用同一个 thread id 更新，legacy `session_index.jsonl/history.jsonl` 会替换旧行。
- 导入前会给 `state_5.sqlite` 写一份 `state_5.sqlite.backup-before-opal-mirror-import-*` 备份。
- 如果 Codex App 正在运行，sidebar registry 写入会被延后，因为 App 退出时可能从内存覆盖 `~/.codex/.codex-global-state.json`。完全退出 Codex App 后运行 repair 命令即可补上：

```bash
node repair_codex_app_frontend.mjs --archive ./ai-chat-archive --codex-home ~/.codex
# 或 npm script:
npm run repair:codex-app -- --archive ./ai-chat-archive --codex-home ~/.codex
```

只修 App rollout 文件 mtime、不碰 sidebar registry，可在 App 运行时执行：

```bash
node repair_codex_app_frontend.mjs --archive ./ai-chat-archive --codex-home ~/.codex --fix-mtime-only
```

导入后可检查：

```bash
sqlite3 ~/.codex/state_5.sqlite \
  "select title, datetime(updated_at_ms/1000, 'unixepoch'), rollout_path from threads where title like '[webchat:%' order by updated_at_ms desc limit 5;"
```

## 增量同步

每次跑 sync 会先比对 `updated_at` / `update_time`，未变化的会话直接跳过。第一次全量拉，后面每次几秒就完事。

可以挂 cron / launchd 每天跑一次：

```cron
0 9 * * * cd /path/to/opal-mirror && /usr/local/bin/node sync.mjs > /tmp/opal-mirror.log 2>&1
```

## 已知限制

- **ChatGPT 限流**：OpenAI 在 `/backend-api/conversation/{id}` 上限制大约每 session ~200 个 detail 请求。脚本带 1.5s 节流 + 指数 backoff + 连续 5 次失败自动 abort。**首次全量后限流通常会重置**，分多天跑能把所有会话都拿到。
- **Gemini 仅侧栏可见**：Gemini 把更老的对话沉到 Google Activity，Web 侧栏看不到。完整历史只能走 Google Takeout。
- **DeepSeek 反爬**：纯 HTTP 请求会触发 AWS WAF challenge，所以**必须**走 CDP 在浏览器内部 fetch。本仓库已采用此方式。
- **豆包内容多模态**：除文本外还有图片/语音/工具调用等 `content_block` 类型，原始结构全保留，但 `build_index.mjs` 只统计文本字符数。
- **千问的 `ut`**：从 `localStorage.qianwen-uniq-id` 取，每个用户唯一。
- **依赖站点 DOM/API 不变**：站点改版可能让脚本失效。出问题时先用 DevTools Network 抓抓内部接口确认。
- **Claude 多账号**：脚本会枚举 `/api/organizations` 下所有组织依次同步，但只用当前 tab 的登录态——切换账号需自己换 tab。

## 测试

```bash
npm test
npm run test:e2e
npm run test:all
```

默认 `npm test` 只跑不依赖真实聊天归档的 Codex 导入测试。`test:e2e` / `test:all` 需要当前机器上有实际 archive 或可用 CDP 登录态。

`test_e2e.mjs` 跑 7 组测试 / 15 个用例：

- T1 — JSON 文件可解析
- T2 — Schema 必需字段都在
- T3 — 文件名 ↔ 内部 ID 一致
- T4 — 实际消息内容非空
- T5 — 中文/CJK 标题无乱码
- T6 — Gemini 对话顺序 user/model 正确交替
- T7 — 增量同步：重跑 Claude 应保存 0 个新会话

`test_codex_export.mjs` 用临时 archive 验证 Codex 导入：

- rollout JSONL 包含可见的 user / assistant transcript 事件
- terminal 和 Codex App mirror 的文件 mtime、SQLite `updated_at_ms`、App thread id 时间前缀使用 web chat 原始时间
- `state_5.sqlite` threads 注册可被 `/resume` 发现
- Codex App frontend registry 可 repair 且幂等
- 重复导入不会重复追加 legacy index

## 添加新平台

每个适配器约 30-50 行代码。模式：

1. 找到该平台 list / detail 的内部 API（DevTools Network 一开就看到）
2. 在 `sync.mjs` 加一个 `syncFoo()` 函数，复用 `evalIn(targetId, expr)` 在已登录 tab 里执行 `fetch()`
3. 决定 schema：能直接存原始 API 响应就直接存
4. 在 `Main` 段加上分支

DeepSeek / 豆包 / 千问 已实现。GLM / MiniMax / Kimi / 智谱 等待补，PR welcome。

## License

MIT
