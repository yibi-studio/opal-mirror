# chat-history-sync

把 Claude / ChatGPT / Gemini 网页端的历史对话同步到本地 JSON 备份。

不依赖第三方服务、不导出 cookie、不暴露 token——通过 [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) 让你**已经登录的 Chrome 标签页自己调它后端的 API**，结果回传到本地。

## 为什么这样做

各家 LLM 的 Web App 历史导出现状：

| 平台 | 官方导出 | 备注 |
|---|---|---|
| ChatGPT | ✅ Settings → Data Controls → Export | 异步邮件，链路长 |
| Claude | ✅ Settings → Privacy → Export | 同上 |
| Gemini | ⚠️ 通过 Google Takeout | 时延较高 |
| 国产几家（DeepSeek / 豆包 / 千问 / GLM / MiniMax） | ❌ 全无 | 只能抓 |

**官方导出难自动化**（异步、要解析邮件链接、有时效），但 Web App 本身是普通 REST 应用——既然浏览器能加载历史，让它自己拉就好。

## 方案

```
Node 脚本 ──HTTP──▶ CDP Proxy(:3456) ──CDP──▶ Chrome ──页面内执行JS──▶ 站点API
                                                                          │
   ◀────────── JSON 结果回传 ────────────────────────────────────────────┘
```

让 `fetch()` 跑在浏览器页面上下文里——cookie/token 自动带上，跨域/CSRF 全免。

## 三家分别怎么实现

| 平台 | 路线 | 端点 |
|---|---|---|
| **Claude** | 干净 REST | `GET /api/organizations/{org}/chat_conversations/{uuid}` |
| **ChatGPT** | REST + Bearer token | `GET /backend-api/conversation/{id}`（先从 `/api/auth/session` 拿 access token） |
| **Gemini** | DOM 抓取 | 没有可用 REST，逐个会话 navigate 到 `/app/{id}`，读 `<user-query>` / `<model-response>` |

## 前置条件

1. **Node.js** 18+
2. **Chrome 启动时带远程调试**：
   - 在 `chrome://inspect/#devices` 勾选 "Allow remote debugging for this browser instance"
   - 或启动时加 `--remote-debugging-port=9222`
3. **CDP Proxy 服务** 跑在 `localhost:3456`
   - 我个人用的是 [`eze-web-access`](https://github.com/anthropics/claude-code) 里的 CDP proxy，任何转发 CDP 的 HTTP 代理都行
   - 必须支持以下端点：`GET /targets`、`POST /eval?target=<id>`、`GET /new?url=<url>`、`GET /navigate?target=<id>&url=<url>`
4. **在该 Chrome 里登录** claude.ai / chatgpt.com / gemini.google.com

## 用法

```bash
git clone https://github.com/1va7/chat-history-sync.git
cd chat-history-sync

# 全量同步三家（增量、跳过已存）
node sync.mjs

# 单独同步某家
node sync.mjs claude
node sync.mjs chatgpt
node sync.mjs gemini

# 生成可读的索引表
node build_index.mjs

# 跑测试套件
node test_e2e.mjs
```

输出默认在脚本同级的 `ai-chat-archive/`（自包含项目目录）。改路径：

```bash
AI_CHAT_ARCHIVE_DIR=/path/to/archive node sync.mjs
```

CDP Proxy 不在 3456 端口：

```bash
CDP_PROXY=http://localhost:9999 node sync.mjs
```

## 输出结构

```
<repo>/ai-chat-archive/      # 默认与脚本同级，可被 AI_CHAT_ARCHIVE_DIR 覆盖
├── INDEX.md              # 可读索引（build_index.mjs 生成）
├── claude/{uuid}.json
├── chatgpt/{conversation_id}.json
└── gemini/{id}.json
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

## 增量同步

每次跑 sync 会先比对 `updated_at` / `update_time`，未变化的会话直接跳过。第一次全量拉，后面每次几秒就完事。

可以挂 cron / launchd 每天跑一次：

```cron
0 9 * * * cd /Users/you/chat-history-sync && /usr/local/bin/node sync.mjs > /tmp/chat-sync.log 2>&1
```

## 已知限制

- **ChatGPT 限流**：OpenAI 在 `/backend-api/conversation/{id}` 上限制大约每 session ~200 个 detail 请求。脚本带 1.5s 节流 + 指数 backoff + 连续 5 次失败自动 abort。**首次全量后限流通常会重置**，分多天跑能把所有会话都拿到。
- **Gemini 仅侧栏可见**：Gemini 把更老的对话沉到 Google Activity，Web 侧栏看不到。完整历史只能走 Google Takeout。
- **依赖站点 DOM/API 不变**：站点改版可能让脚本失效。出问题时先用 DevTools Network 抓抓内部接口确认。
- **Claude 多账号**：脚本会枚举 `/api/organizations` 下所有组织依次同步，但只用当前 tab 的登录态——切换账号需自己换 tab。

## 测试

`test_e2e.mjs` 跑 7 组测试 / 15 个用例：

- T1 — JSON 文件可解析
- T2 — Schema 必需字段都在
- T3 — 文件名 ↔ 内部 ID 一致
- T4 — 实际消息内容非空
- T5 — 中文/CJK 标题无乱码
- T6 — Gemini 对话顺序 user/model 正确交替
- T7 — 增量同步：重跑 Claude 应保存 0 个新会话

## 添加新平台

每个适配器约 30-50 行代码。模式：

1. 找到该平台 list / detail 的内部 API（DevTools Network 一开就看到）
2. 在 `sync.mjs` 加一个 `syncFoo()` 函数，复用 `evalIn(targetId, expr)` 在已登录 tab 里执行 `fetch()`
3. 决定 schema：能直接存原始 API 响应就直接存
4. 在 `Main` 段加上分支

DeepSeek / 豆包 / 千问 / GLM / MiniMax 都已验证 list+detail API 可达，PR welcome。

## License

MIT
