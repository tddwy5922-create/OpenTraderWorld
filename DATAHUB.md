# OpenTraderWorld（OTW）数据流水线与信息中枢评估报告

> **评估范围**：仅覆盖**美股 + 加密（OKX 永续为主、现货为辅）**，所有交易所与券商接口严格按**只读行情/持仓视图**使用。所有结论均标注 `file:line`；无直接代码证据处标注「推测」。

---

## A. 一段话结论

OpenTraderWorld 的底层骨架（Rust/Axum + PostgreSQL 18 + 多路复用 WebSocket `/api/live/ws` + 统一 Connector SDK + 指标/告警引擎 + MCP/入站 Webhook）**具备成为美股+加密只读信息中枢的工程基础，但当前开箱状态不能直接作为可靠的个人监控中枢使用**。核心原因不在功能少，而在链路存在隐蔽断点和跨模块割裂，**最缺的三件事**是：

1. **链路活性与新鲜度真实可见（止血 Bug）**：OKX WS 应用层 20s `"ping"` 保活在静默行情下被主循环 `continue` 永久跳过导致 30s 反复断线（`core/otw-core/src/live/mod.rs:554-571,621-625`），同时前端图表 `liveLag` 断流冻结、Browser WS 心跳掩盖上游卡死、Dashboard 多个状态卡片存在假绿灯/状态字错配（`Pane.svelte:1762,2461-2464`、`WatchlistWidget.svelte:200-203`、`HistdataWidget.svelte:53,60`）。
2. **OKX 永续/现货全站统一取价与标的联动闭环**：组合估值数据库约束直接禁止 OKX（`migrations/0037_portfolio_reconcile.sql:25-26`），自选表缺少 OKX 默认 ticker 映射且绕过实时行情改拉 3 小时 1m 闭盘 K 线（`watchlists/quotes.rs:697-712,757-776`）；Watchlist 新闻角标与 `/news` 页搜索口径错配，尚无法做到「点 NVDA 原地看最近新闻 + 异动提醒」。
3. **长期运行的抗断网与运维底座**：断网 3 天后所有自动机制（`histdata_refresh` 200 根固定窗口、Live `spawn_seed` 单页 ≤300 根）都会留下永久历史空洞；`histdata_bars`/`feed_items`/`notifications` 无自动老化清理；`/health` 只探 `SELECT 1`，且告警系统缺少通用出站 HTTP Webhook 通道以联动外部系统（如 Hermes）。

---

## B. 数据流水线逐段体检（第一条线）

### B.1 逐段体检总表

| 链路阶段 | 现状（含 `file:line`） | 核心缺口 | 改法 | 验收标准 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| **1. Connector 采集层** | 统一 `Driver` + `Mapper` 架构（`core/connectors/sdk/src/driver.rs`）。OKX 分 `spot`/`swap` 双配置，分页 300 根、声明限流并用 `paced_driver`（`okx/mod.rs:48`、`histdata/native.rs:427-440`）；Yahoo 硬编码 `query1` 且走无令牌桶的 `shared_driver`（`yahoo/mod.rs:16`、`native.rs:405-418,1064`）；Watchlist/Portfolio 直连 Yahoo/CoinGecko 不走 SDK 限流（`watchlists/quotes.rs`、`portfolios/prices.rs`）。 | ① Yahoo/Alpaca/Massive/AV/EODHD 未挂载 `TokenBucketLimiter`；② Yahoo 无 `query2` 备域切换；③ OKX WS 20s `"ping"` 死代码导致 30s 断线（`live/mod.rs:554-571`）；④ Watchlist 缺 OKX ticker 映射（`watchlists/quotes.rs:697-712`）。 | ① `live/mod.rs` 删除 `idle_check` 分支 `continue` 确保每 5s 驱动 `drain_sends()`；② Yahoo/美股源切换 `paced_driver` + 增加 `query2` fallback；③ `watchlists/quotes.rs` 补 OKX `BTC-USDT-SWAP`/`BTC-USDT` 映射并改用 ticker 接口。 | OKX WS 静默行情连续保活 >2h 零断线；Yahoo 429 自动降速/切备域；Watchlist 选 OKX 直接出永续价。 | 8–12h |
| **2. HistData 落库与回填** | PG18 单表 `histdata_bars` 存 9 列 `NUMERIC` + 8 列 bid/ask `NUMERIC`，PK `(dataset_id, ts)`（`0021_histdata.sql:51-65`、`0140_histdata_quotes.sql:4-12`）；下载任务串行单队列 + 3 次重试 + 429 停泊（`histdata_job.rs:36-47,388-435`）；定时刷新固定尾部 200 根无重试（`histdata_refresh.rs:36-47,292-296,316-318`）；补洞检查仅手动 API（`histdata_check.rs`）。 | ① 每次 `write_bars`（含每分钟闭盘写 1 根）触发 `SELECT min/max/count(*)` 聚合（`otw-store/src/histdata.rs:767-777`）；② 断网 3 天后 `refresh` 与 `spawn_seed` 均留永久空洞；③ `histdata_bars` 与 `intrabar` 无分区、无压缩、无 TTL 清理；④ `max_connections(10)` 无 `statement_timeout`（`otw-store/src/lib.rs:108-110`）。 | ① `write_bars` 改增量维护 `range_from/range_to/bar_count`；② `histdata_refresh` 改为从 `dataset.range_to` 动态向 `now` 分页补齐并接入失败重试；③ `spawn_seed` 改为分页拉取；④ 增配 PG `statement_timeout=15s` 与热/冷周期保留任务。 | 断网 72h 恢复后 1m/5m/1h 数据自动零空洞补齐；1m 实盘落库 SQL 耗时 <5ms；50+ 标的并发不触发池耗尽。 | 14–20h |
| **3. 缓存与中间态** | 后端：`SYMBOLS_TTL=6h` 内存缓存（`histdata/mod.rs:314-335`）、Watchlist `HISTORY_TTL=6h`（`watchlists/quotes.rs:32-36`）、Portfolio CoinGecko 列表 `30m` PG 缓存支持过期降级（`portfolios/prices.rs:31-32,484-490`）。前端：`seriesCache.js` 内存+IndexedDB 双层缓存（20 序列/40 万根，默认 `1d`）。 | ① 跨模块缓存孤立：LiveHub 已有 OKX 实时价，Watchlist/Portfolio 却重复轮询 HTTP 且不共享；② Watchlist 前端每 30s 重读 DB（`WatchlistDetail.svelte:280-286`），而 Dashboard Watchlist/Portfolio 卡片每 6s 轮询（`dashboard/live.svelte.js:89`），频率倒挂。 | ① LiveHub 暴露进程内最新报价快照供 Watchlist/Portfolio 只读复用；② 统一 Dashboard 轮询周期（Portfolio 改 60s+，Watchlist 跟随 `refresh_secs`）。 | OKX 永续标在图表/自选/组合三处读同一内存价，外部 HTTP 请求量降 ≥60%。 | 8–12h |
| **4. LiveHub 与 SSE/WS 推送** | 后端 `LiveHub` 按 `(connector, provider, asset, ticker, tf)` 引用计数复用上游连接，指数退避 `1s→30s`，断线 `120s` 通知告警（`live/hub.rs:138-145,721-808`、`live/outage.rs:17-21`）。单页浏览器共用 1 条 `/api/live/ws` 多路复用（`MAX_SUBS=32`, `PING=15s`, `QUOTE_EVERY=250ms`）（`live_ws.rs:62-72`、`histdata_api.rs:111`）。 | ① `histdata_api.rs:414` 广播通道 `Lagged` 时静默丢弃 K 线且不通知前端重同步；② `live/poll.rs:430` 美股轮询单标的失败不触发 `outage` 告警；③ `catch_up` 上限 300 根且补回的 K 线不落库（`histdata_api.rs:116,580-594`）；④ `stream.js:87,94` 收到 `ping` 刷新 `lastFrame`，掩盖上游静默断流。 | ① `Lagged` 时向客户端下发 `resync` 状态事件触发 `checkTail()`；② 为 `live/poll.rs` 接入连续失败告警；③ `live_ws` 在 `status` 周期附带各订阅最后上游时间戳 `last_bar_at`。 | 人为制造后端广播堆积或上游停流 45s 后，前端自动进入 `stale` 并在恢复后自动补齐缺口。 | 6–10h |
| **5. 前端图表与看板呈现** | 图表支持自动重连、切回标签页自动 `checkTail()` 检测缝隙并按 `30/60/120/300s` 自动重试补洞（`Pane.svelte:1853-1963`）；Bid/Ask 报价有 `60s` 过期清除（`Pane.svelte:353,452-453`）；`liveLag` 显示最后一笔网络延迟（`Pane.svelte:1762,2462-2464`）。 | ① K 线无「距上次更新 N 秒」计时与 Stale 徽章，上游静默时绿点+旧 `ms` 永不消失；② `WatchlistWidget` 同步状态卡片只要曾刷新过就永久绿灯（`WatchlistWidget.svelte:200-203`）；③ `HistdataWidget` 过滤 `'failed'` 而 DB 存 `'error'`，失败列表恒空（`HistdataWidget.svelte:53,60`）。 | ① `Pane.svelte` 记录 `lastBarRecvAt` 并每秒计算 age，超阈值（WS 30s / 轮询 2.5×`poll_secs`）转橙色 `Stale`；② 修复 `WatchlistWidget` 过期判定；③ 修复 `HistdataWidget` 状态字 `'error'`/`'partial'`。 | 断掉 OKX 上游 35s 内图表变橙并显示「已延迟 Xs」；Watchlist 超 2×周期变过期；下载失败任务在 Dashboard 准确展示。 | 4–6h |

---

### B.2 问题 1：各数据源刷新节奏、缓存 TTL 与重连策略一览

| 数据源 / 模块 | 覆盖标的 | 传输方式 | 轮询间隔 / 推送节奏 | 缓存与 TTL | 重连 / 保活 / 退避策略 | 代码位置 (`file:line`) |
| --- | --- | --- | --- | --- | --- | --- |
| **OKX 永续 / 现货（Live）** | 加密永续(`SWAP`) + 现货(`SPOT`) | 原生 WS（`candle{tf}` + `bbo-tbt`） | 实时推送；报价节流 `QUOTE_EVERY=250ms`；频道缓存 `CHANNEL_CAP=1024` | 内存最新 forming bar + quote；收线自动写 `histdata_bars`（仅已存 dataset） | Hub 退避 `1s→30s` 指数；冲突直接 `30s`；致命错误停止；`TEARDOWN_GRACE=20s`；应用层 `"ping"` 每 `20s`（**有 Bug 未执行**）；协议层 `WS_IDLE=60s`、`WS_PONG_WAIT=20s` | `okx/stream.rs:25,115-128`<br>`live/hub.rs:138-145,721-808`<br>`live/mod.rs:481,554-571,621-625`<br>`histdata_api.rs:111` |
| **OKX REST（历史/报价）** | 加密永续 + 现货 | HTTP REST | 按需 / `histdata_job` 串行；单页上限 `PAGE=300` 根 | `SYMBOLS_TTL=6h` 进程内存缓存 | SDK `TokenBucketLimiter`（`paced_driver`）；下载失败重试 3 次（`2/4/6s`），429 停泊 `Retry-After` 或 `60s→3600s` | `okx/mod.rs:48,282-294`<br>`histdata/mod.rs:314-335`<br>`histdata_job.rs:36-47,388-435` |
| **Yahoo Finance（Live 轮询）** | 美股 / ETF / 指数 | HTTP 轮询（`live/poll.rs`） | 默认 `15s`，范围 `[5s, 3600s]`，每次拉 `POLL_BARS=5` 根 | 无独立行情缓存；`SYMBOLS_TTL=6h`；历史深度上限 `1m:30d / 5m,15m:60d / 1h:730d` | 失败退避 `poll * 2^failures` 上限 `300s`，遵守 `Retry-After`；`caps.rs` `min_interval_ms=600`；**SDK 层无令牌桶** | `live/poll.rs:36-47,226-228,334-445`<br>`histdata/caps.rs:457,809-812`<br>`histdata/native.rs:405-418,1064` |
| **Alpaca / Massive / AV / EODHD** | 美股 / ETF | Alpaca/Massive 支持 WS；AV/EODHD 仅轮询 | 轮询同 `live/poll.rs` 默认 `15s`；WS 同 `LiveHub` | `SYMBOLS_TTL=6h` | 同 `LiveHub` / `live/poll.rs`；**全部走 `shared_driver` 无 SDK 令牌桶** | `histdata/native.rs:919-920,1033,1042,1050` |
| **Watchlists 报价轮询** | 美股(Yahoo) + 加密(CoinGecko 或指定 Connector) | 后台轮询 + 缓存读 | 调度 tick `5s`；单列表 `refresh_secs` 下限 `60s`（Auto）/ `5s`（Connector），上限 `86400s`；调用间隔 `250ms`；前端页面每 `30s` 读库 | 存 `watchlist_items.quote` JSONB；历史涨跌/Sparkline `HISTORY_TTL=6h`；无过期失效 | 单标的失败写入 `quote.error` 保留旧价；无自动退避与告警；`housekeeping=3600s`，`digest=60s` | `watchlists/mod.rs:29-36,82`<br>`watchlists_api.rs:29-31`<br>`watchlists/quotes.rs:32-36`<br>`WatchlistDetail.svelte:280-286` |
| **Portfolios 组合估价** | 美股(Yahoo) + 加密(CoinGecko/Binance/Kraken/Coinbase) | 后台定时 HTTP | 每小时唤醒检查 UTC 跨日（**每日 1 次**自动刷新）；手动刷新按需 | `portfolio_coingecko_cache` `COIN_LIST_TTL=30m`（报错自动降级读过期缓存） | 历史曲线重算读本地 `histdata_bars` 日线；无日内刷新；**不支持 OKX** | `portfolios/mod.rs:21-43`<br>`portfolios/prices.rs:31-32,324-335,484-490`<br>`migrations/0037_portfolio_reconcile.sql:25-26` |
| **HistData 定时刷新** | 任意已存 Dataset（手动开启） | 后台批处理 | `TICK=30s`，每轮最多 `MAX_PER_TICK=8` 个；单表周期 `[60s, 31d]`，拉固定 `DEFAULT_WINDOW=200` 根（上限 `10000`） | 直接 upsert 进 `histdata_bars` | **无重试、无退避**；失败仍写 `last_refresh_at=now`，跳过整周期 | `histdata_refresh.rs:36-47,241-245,292-296,316-318` |
| **浏览器多路复用 WS & 前端缓存** | 全站所有实时流 + 图表序列 | 单标签页 1 条 `/api/live/ws` + IndexedDB | 服务端心跳 `15s`；客户端 idle 检测每 `5s`，超时 `45s`；Dashboard 卡片 `livePulse`：`runs=3s / quotes=6s / inbox=12s / agenda=30s`；Scanner 卡片 `60s`；Fundamentals/Quant `300s` | `seriesCache.js`：内存 + IndexedDB `otw-chart-cache`，上限 20 序列 / 40 万根，默认保留 `1d`（`tab/1h/6h/1d/3d/7d`），每 `1h` 清理 | 客户端断线退避 `[1,2,4,8,15,30]s`；429/5xx 重试，4xx 标 `refused` 停试；`STALL=10s` 服务端断写 | `sse.rs:21`、`live_ws.rs:62-72`<br>`frontend/src/lib/live/stream.js:39-44,77,249`<br>`seriesCache.js:15-36`<br>`dashboard/live.svelte.js:87-92` |
| **Feeds 新闻采集** | RSS + JSON API | 后台串行轮询 + SSE 通知 | 调度 tick `10s`，每轮领 `20` 个到期源（仅 `started` 看板）；单源默认 `900s`，范围 `[30s, 86400s]` | 永久落 `feed_items`；无 TTL 清理 | 仅 429/503 读 `Retry-After`；其他错误原间隔重试；前端 `/news` 轮询 `60s` + SSE 提示角标 | `otw-scheduler/src/lib.rs:17,75,80-86,177-182`<br>`otw-feeds/src/lib.rs:116-130`<br>`feeds_api.rs:154,181`<br>`news/+page.svelte:154,188-192` |

---

### B.3 问题 2：数据新鲜度判断与 Stale 降级现状

| 视图 / 场景 | 前端能否看出「这根 K 线/报价是几秒前的」？ | 有无 Stale 标记或超时降级？ | 实测缺陷与证据 (`file:line`) |
| --- | --- | --- | --- |
| **图表 K 线（WS 实盘，如 OKX）** | **不能**。顶栏仅显示最后一帧的传输延迟 `liveLag`（如 `42 ms`），不显示「距上次收到更新已过 N 秒」。 | **无**。断流时状态灯保持绿色，`liveLag` 停在最后一次成功数值，永不衰减。 | `live/mod.rs:206-250` 下发 `lag_ms=now-provider_ts`；`Pane.svelte:1762,2447,2461-2464` 仅在收到 `bar` 时覆写 `liveLag`，无定时器检测静默；`stream.js:87,94` 收到 `op:'ping'` 即重置 `lastFrame`，掩盖上游静默。 |
| **图表 K 线（轮询实盘，如 Yahoo）** | **部分可感知**。顶栏展示「每 N 秒轮询」（`polledNote`），不展示上次成功时间。 | **无**。轮询卡住或进入 `300s` 退避时仅展示 `liveStatus.message`（若有）。 | `Pane.svelte:409-413,2463`；`live/poll.rs:430` 仅发 `FeedUpdate::fault`。 |
| **图表盘口 Bid/Ask 线** | **无具体秒数**，但具备防僵死保护。 | **有（较完善）**：连续 `60s` 无新 quote 自动清除盘口线，避免冻结报价误导。 | `Pane.svelte:353,449-458`（`QUOTE_STALE_MS = 60_000`）。 |
| **自选股页面（Watchlists）** | **粗略可见**。页头展示整表「X 分钟前更新」（每 `30s` 刷新文本），单行价格悬停 tooltip 显示 `quoted_at`。 | **无 Stale 变色/降级**。单行刷新失败时显示黄色三角 `quote.error` 并继续展示旧价，不标旧价已过期多久。 | `WatchlistDetail.svelte:129,280-286,491-494,842-849`。 |
| **Dashboard 自选同步卡片（`sync`）** | **误导性展示**。虽显示 `agoLabel(lastQuoted)`，但状态圆点与文案永远写死「最新」。 | **逻辑 Bug（假绿灯）**：仅当 `lastQuoted == null` 才标 `stale`；哪怕数据已过期 30 天仍显示绿点 + "Up to date"。 | `WatchlistWidget.svelte:197-215`（`class:stale={!lastQuoted}`）。 |
| **组合估值（Portfolios）** | **弱可见**。仅每日 UTC 零点后刷新一次，无日内时间戳对比。 | **有部分缓存降级**：CoinGecko 失败时降级读过期 `portfolio_coingecko_cache`。 | `portfolios/mod.rs:21-43`、`portfolios/prices.rs:484-490`、`PortfolioWidget.svelte:94-95`。 |
| **基本面卡片（Fundamentals）** | **较完善**。展示 `closeAsOf` / `updated` 日期与来源，且有 `stale` 橙色提示。 | **有**：`price.stale` / `snap.stale` 明确渲染警告。 | `FundamentalsWidget.svelte:191-192,222`。 |

---

### B.4 问题 3：典型故障场景与降级链路定位

| 故障场景 | 实际发生什么（逐步传导） | 重试 / 退避 / 熔断 / 告警现状 | 断点定位 (`file:line`) |
| --- | --- | --- | --- |
| **场景 1：OKX WS 静默断线 / 网络闪断** | ① 行情清淡超过 20s 无入站帧时，`run_feed` 的 5s `idle_check` 分支直接执行 **`continue;` 跳过循环尾部的 `feed.drain_sends()`**，导致 OKX 的 20s 应用层 `"ping"` 永远发不出去；② 第 30s OKX 主动踢断连接（协议层 `WS_IDLE=60s` 尚未触发）；③ `LiveHub` 感知断线并触发重连 + `spawn_seed` 回补，**但单页最多补 300 根**且写入 `last_closed`，造成持续断连抖动与历史漏洞。 | Hub 有 `1s→30s` 指数退避（`live/hub.rs:721-808`）；持续断开 `120s` 后发断线通知、恢复稳态 `60s` 发恢复通知（`live/outage.rs:17-21`）；**无熔断**；**静默保活已失效**。 | **死代码断点**：`core/otw-core/src/live/mod.rs:554-571`（`continue;`）跳过 `:621-625`（`drain_sends`）→ `live/native.rs:497-519` → `okx/stream.rs:115-128`。 |
| **场景 2：Yahoo Finance 返回 HTTP 429** | ① **下载任务**：重试 3 次（2/4/6s）后停泊为 `waiting`，按 `Retry-After` 或 `60s→3600s` 恢复，等待 ≥5m 发通知（**此路径较健壮**）；② **定时刷新（`histdata_refresh`）**：直接报错、写 `last_refresh_at=now`，跳过整周期；③ **Watchlists / Portfolios**：直连 `query1.finance.yahoo.com`（无 `query2` 备域、无 SDK 限流），429 直接写入 `quote.error` 或静默保留旧价；④ **Live 轮询（`live/poll`）**：按 `poll * 2^n`（上限 `300s`）退避，发前端 `fault` 状态，但**不触发外部通知告警**。 | 仅 `histdata_job` 有停泊+通知；`yahoo` 走 `shared_driver` **无令牌桶**，Watchlist/Portfolio 绕过 `min_interval_ms=600`；`api_rate` 明确注释「仅观察，不限流」。 | `yahoo/mod.rs:16`（硬编码 `query1`）<br>`histdata/native.rs:405-418,1064`<br>`histdata_refresh.rs:241-245,316-318`<br>`live/poll.rs:334-445`<br>`rate_api.rs:5` |
| **场景 3：PostgreSQL 慢查询 / 连接池耗尽** | ① `otw-store` 全进程仅 1 个 `max_connections(10)` 连接池，被所有 HTTP API + ~15 个后台协程 + 每条日志单独 `INSERT`（`DbLogLayer` 无界通道）+ 每次出站 HTTP 独立 `tokio::spawn` 写 `api_rate` 共同争抢；② 每写入一批 K 线（含每分钟 1 根实盘收线）都要执行 `SELECT min(ts), max(ts), count(*) FROM histdata_bars WHERE dataset_id=$1`；③ Watchlist `news_counts` 对无三元组索引的 `feed_items.title` 做正则 `~`/`~*` 全扫描；④ **数据库未设 `statement_timeout`**，慢查询可占住连接长达 `120s`（HTTP 超时），期间 sqlx 默认 30s 取连接超时导致全站 API 与后台任务级联 500/失败。 | 无慢查询日志阈值、无 `statement_timeout`、无连接池监控/告警、无读/写池隔离；仅回测/量化接口有 `compute_gate` 并发门控（`main.rs:695`）。 | `otw-store/src/lib.rs:108-110`（`max_connections(10)`）<br>`otw-store/src/histdata.rs:767-777`<br>`otw-store/src/watchlists.rs:618-624`<br>`log_layer.rs:32-42`、`api_rate.rs:70-89`<br>`security.rs:397`、`main.rs:757` |

---

### B.5 问题 4：多源冲突与跨模块取价一致性

同一标的被多源覆盖时（如 **BTC** 同时存在 OKX 永续、OKX 现货、CoinGecko；**NVDA** 同时存在 Yahoo、Alpaca/Massive），**系统没有全局统一行情真相源（Single Source of Truth）**，三处取价逻辑各自为政：

| 维度 | Watchlists（自选表） | Portfolios（组合估值） | HistViz（图表与实盘） | 一致性结论 |
| --- | --- | --- | --- | --- |
| **默认行情源** | Auto 模式：加密=CoinGecko `coins/markets`，美股=Yahoo `v8/finance/chart`（`watchlists/quotes.rs:389`） | 加密=CoinGecko `/simple/price`，美股=Yahoo `regularMarketPrice`（`portfolios/prices.rs:324-335`） | 显式坐标 `(provider, asset_type, ticker, timeframe)`，**绝不用 CoinGecko**（`histdata_api.rs:92-106`） | **不一致**：加密在图表看 OKX 永续，在自选/组合默认看 CoinGecko 现货聚合价。 |
| **多源冲突时谁赢？** | 优先级：`item.quote_source`（显式指定） > `watchlist.connector_id`（列表默认，且匹配 `asset_type`） > Auto（`WatchlistDetail.svelte:399-409`） | 现价：`asset.spot_provider` 显式选定，仅允许 `coingecko\|yahoo\|binance\|kraken\|coinbase`；历史曲线重算：`find_dataset_any` 按授权优先，平局取 `bar_count` 最大者（`portfolios/history.rs:133-140,319-322`） | 用户/工作区绑定的 `connector_id` + `provider` 唯一决定；未指定时取最早授权给 `histviz` 的 connector（`histdata_api.rs:501-539`） | **规则分裂**：同属加密组合，日内估值用 CoinGecko，历史净值曲线可能用 `bar_count` 更大的 Binance/OKX 日线，首尾接缝易跳变。 |
| **能否使用 OKX 永续/现货？** | **存在 2 个硬伤**：① `default_quote_ticker` 漏写 `"okx"`（`watchlists/quotes.rs:697-712`），绑定 OKX 后传裸 `"BTC"` 报 51001，须逐条手动改写 `BTC-USDT-SWAP`；② `quote_via_connector` 拉最近 3 小时 **已收盘 1m K 线** 取价（`:757-776`），恒滞后 1–2 分钟且非实时买一/最新成交价。 | **完全不支持**：DB CHECK 约束硬编码排除 OKX（`migrations/0037_portfolio_reconcile.sql:25-26`、`portfolios/prices.rs:324-335`）。 | **原生支持最优**：WS 直连 OKX `candle` + `bbo-tbt`；但 `RequestBoard`（`okx/mod.rs:411-414`）仅拉 `SPOT` ticker 不拉 `SWAP`。 | **严重割裂**：OKX 永续无法在三处保持同价同源。 |
| **跨模块联动副作用** | Auto CoinGecko 加密标的 `chart_coords = None`（`watchlists/quotes.rs:389,924`），列表「打开图表」按钮置灰不可用。 | 每日仅更新 1 次，Dashboard 却每 6s 轮询（`PortfolioWidget.svelte:29`），导致与自选表日内价差显著。 | 实盘仅对「已存 dataset」自动录制闭盘 K 线（`histdata_api.rs:130-131`），未存标的切出即丢。 | 三处价格**在加密永续上经常相差 0.05%–0.5%+（基差+延迟）**，美股盘中相差 15s–24h。 |

---

### B.6 问题 5：存储增长、清理机制与 5 核 11G 机器 1 年容量估算

#### 1. 核心数据表结构与老化清理现状

| 数据表 | 存储结构与索引 (`file:line`) | 分区 / 压缩 | 自动清理（TTL / 裁剪） | 风险等级 |
| --- | --- | --- | --- | --- |
| `histdata_bars` | 堆表；`PK(dataset_id, ts)`；9 列 `NUMERIC` + 8 列 bid/ask `NUMERIC`（`0021_histdata.sql:51-65`、`0140_histdata_quotes.sql:4-12`） | **无分区、无压缩**（纯 PG18） | **无**（仅手动删 dataset 级联删） | **高**：高频 1m/5m 持续录制无限膨胀，单表 B-tree 变深且 `write_bars` 每次聚合扫描。 |
| `histdata_intrabar_bars` / `_windows` | 堆表；PK 含 5 列含文本（`0141_histdata_intrabar_cache.sql:4-35`） | **无分区、无压缩** | **无**（永久缓存） | **中**：仅使用回测 intrabar 时增长。 |
| `feed_items` | 堆表；含 `title`/`summary`/`raw JSONB`；索引：`published_at`、`feed_id`、`source_type`（`0005_feeds.sql:31-47`） | **无分区**（仅 PG TOAST 压缩超 2KB 字段） | **无**（永久累积） | **高**：API 源存整包 `raw JSONB`（`otw-feeds/src/lib.rs:362`），且 Watchlist 新闻正则查询扫描变慢。 |
| `notifications` | 堆表；索引 `created_at`、`read_at`（`0016_reminders.sql:35-47`） | 无 | **无** | **低–中**：高频告警下缓慢膨胀。 |
| `app_logs` | 堆表；索引 `at`、`level`（`0028_settings_logs.sql:24-32`） | 无 | **有**：每写入 1000 条裁剪至 `50,000` 行（`logs.rs:15,217-226`、`log_layer.rs:43-49`） | **低**（受控，约 15–30 MB）。 |
| `api_rate_daily` / `_events` | 堆表（`0040_api_rate.sql`） | 无 | **有**：每 6h 裁剪，日汇总留 `30d`，限流事件留 `5,000` 行（`main.rs:433-436`、`api_rate.rs:16-18,181-199`） | **极低**（<5 MB）。 |
| `watchlist_samples` | 堆表；滚动窗口告警价格样本（`0087_watchlist_alerts.sql`） | 无 | **有**：每 1h 按活跃 rolling 窗口的 `2×` 清理（`watchlists/mod.rs:82`、`watchlist_alerts.rs:326-340`） | **极低**（受控）。 |
| `scanner_hits` | 堆表 | 无 | **有**：每日 03:00 UTC 清理 >90 天命中记录（`scanner_job.rs:62,95-100`） | **低**（受控）。 |

#### 2. 5 核 11GB 宿主机 1 年存储与内存估算（美股 + OKX 加密场景）

> 估算基线（单行 PG18 物理开销含 24B 元组头 + 对齐 + PK B-tree 索引 + 15% bloat「推测」）：`histdata_bars` ≈ **180 B/行**；`feed_items`（RSS 含摘要）≈ **1.8 KB/行**，（API 含 `raw JSONB`）≈ **4.5 KB/行**。

| 负载档位（美股 + OKX 永续/现货） | `histdata_bars` 年增行数 | `histdata_bars` 年增磁盘 | `feed_items` 年增磁盘（无清理） | 其余表+WAL/索引冗余「推测」 | **1 年总磁盘增量** | 5C / 11GB 内存压力评估 |
| --- | --- | --- | --- | --- | --- | --- |
| **轻度（个人看板）**：OKX 10 币存 `5m+1h+1d`；美股 30 只存 `15m+1h+1d`；20 条 RSS（日均 400 条） | ~195 万行 | ~350 MB | ~260 MB | ~150 MB | **~0.8 GB / 年** | **轻松**。但 PG 默认 `shared_buffers=128MB`「推测」偏小，建议调至 `512MB`。 |
| **中度（活跃信息中枢）**：OKX 20 币存 `1m+5m+1h+1d`；美股 50 只存 `5m+1h+1d`；40 条 RSS/API（日均 1500 条） | ~1,380 万行 | ~2.5 GB | ~1.5 GB | ~0.8 GB | **~4.8 GB / 年** | **中等偏紧**：`deploy/docker-compose.yml:247` 默认 `OTW_PG_MEM=2g`，`histdata_bars` 索引与热数据将超过 2GB 容器内存上限，触发频繁磁盘读与 `write_bars` 聚合抖动。 |
| **重度（全 1m 录制）**：OKX 50 币全开 `1m+5m+1h`；美股 100 只开 `1m+5m+1h`；高频新闻（日均 5000 条） | ~4,200 万行 | ~7.6 GB | ~5–8 GB | ~2.5 GB | **~15–18 GB / 年** | **高危**：单表 4000 万行无分区 + 默认 `2g` PG 内存 + `max_connections(10)` 必然出现 Autovacuum 滞后与慢查询堆积。 |

> 宿主机内存账（`deploy/docker-compose.yml:67,86,176,198,218,247`）：默认配额 `core(4g) + postgres(2g) + caddy(512m) + dns-proxy(128m) ≈ 6.64 GB`（不开 Whisper 3g），11GB 机器有 ~4GB 余量（若与 Hermes 共机需预留 Hermes 内存）。**中度及以上负载必须为 `feed_items` 加 30–90 天 TTL、为 `1m` K 线加滚动保留或改用 `5m` 为主，并将 `OTW_PG_MEM` 调至 `3g` + 显式配置 PG 参数**。

---

### B.7 问题 6：可观测性现状与缺口

| 可观测性维度 | 现有能力（含 `file:line`） | 缺口（出问题时盲区在哪里） |
| --- | --- | --- |
| **健康检查接口** | `GET /health`（内网，含 version + uptime）与 `GET /api/health`（未登录仅返回 `status`，已登录返回全量），仅探测 `core=up` + PG `SELECT 1`（`main.rs:806-844`）；前端每 `20s` 轮询亮红/橙/绿灯（`ServiceStatus.svelte:8,31-39`）。 | **完全看不到数据层死活**：OKX WS 全断、Feeds 调度器卡死、DB 连接池占满 10/10、Yahoo 持续 429 时，`/api/health` 依然返回 `200 ok` 绿灯。 |
| **日志系统** | `tracing` 输出到 stdout + `DbLogLayer` 异步写 `app_logs`（上限 5 万行），自动脱敏 URL 中的密钥参数，支持 Settings 页面按级别/关键字搜索与运行时调级别（`log_layer.rs:31-94`、`logs.rs:15,83-128,181-208`）。 | ① 仅文本消息，无结构化 JSON 字段（如 `provider`/`ticker`/`latency_ms`），难以按标的聚合排障；② 无界 `mpsc` 通道每条日志单独 `INSERT`，日志风暴时反压 DB 连接池。 |
| **API 限流与错误监控** | `GET /api/rate/usage?days=1..30` 统计各 Provider 请求数/429 次数/错误数及最近 50 条限流事件（`rate_api.rs:18-57`、`api_rate.rs:146-178`）。 | ① 无主动阈值告警（如 Yahoo 10 分钟 429 > 10 次不发通知）；② 仅计 HTTP，不统计 WS 断连次数与消息吞吐。 |
| **后台任务监控** | `GET /api/jobs` + `GET /api/jobs/runs` 统一展示状态/上次报错/支持手动触发与暂停（`jobs_api.rs:14-20`、`jobs.rs:274-400`）。 | **严重漏报**：`/api/jobs` 仅覆盖 `journal-sync`/`portfolio-sync`/`mailbox`/`fx`/`mportfolios` 5 类，**未纳入** `otw-scheduler`(新闻)、`histdata_job`、`histdata_refresh`、`watchlists`、`portfolios` 估价、`live` Hub、`histviz_alerts`、`scanner_job`！ |
| **指标（Metrics）与外部对接** | 无 `/metrics`（Prometheus/OpenMetrics）接口；`deploy/Caddyfile:22-25` 有 JSON 访问日志。 | 无法查看 PG 连接池使用率、LiveHub 活跃连接/重连计数、SSE/WS 客户端数、各源延迟 P95、上次成功抓取时间。 |

---

### B.8 问题 7：断网 3 天后的历史回填与补洞能力

结论：**不能自动补齐，1m/5m 周期必然留下永久性内部空洞**；只有人工逐个执行 `check + fill` 或用户手动翻看图表对应区间才可能补回。

| 机制 | 触发条件 | 断网 72 小时后的实际表现（以 OKX `1m` = 4,320 根、`5m` = 864 根为例） | 代码位置 (`file:line`) |
| --- | --- | --- | --- |
| **1. HistData 定时刷新（`histdata_refresh`）** | 仅对手动开启的 dataset 定时触发（`30s` tick） | **必然留洞**：按固定 `refresh_window_bars`（默认 `200` 根）向 `now` 往前拉；`1m` 只补最后 3.3h、`5m` 只补 16.7h，中间 68h/55h 成为永久空洞；且单次失败无重试直接跳过。 | `histdata_refresh.rs:36-47,292-296,316-318` |
| **2. LiveHub 重连 Seed（`spawn_seed`）** | 实盘流断线重连后自动执行 | **必然留洞并掩盖空洞**：调用 `fetch_seed(stored, now)` **仅拉 1 页不分页**（OKX `PAGE=300` 根，即 `1m` 仅补 5h）；更致命的是 `finish_seed` 会将 `run.last_closed` 推进到 `seed_last`，令后续实时缺口检测完全看不见前面的 67h 断层。 | `live/hub.rs:1114-1146,1193,1215`<br>`histdata/native.rs:284-294`<br>`okx/mod.rs:48,282-294` |
| **3. 实盘连接追赶（`catch_up`）** | 浏览器打开/重连图表流时带 `since` 参数 | **不补超 300 根且不落库**：超 `CATCH_UP_MAX=300` 根直接放弃返回空；≤300 根虽会临时请求上游，但仅推给 SSE 前端、**不写入 `histdata_bars`**。 | `histdata_api.rs:116,547-601,645` |
| **4. 图表看图按片补齐（`/api/histviz/series`）** | 仅当用户主动打开图表或切回标签页触发 `fillSeams` | **局部可补**：前端 `SEAM_MAX_BARS=5000` 触发服务端 `/series` 拉取，服务端最多分页 `SLICE_MAX_CHUNKS=12` 次（OKX 12×300=3600 根，仍覆盖不了 72h 的 4320 根 `1m`），且仅当该标的已存 dataset 时顺带落库。 | `histdata_api.rs:2158-2355`<br>`Pane.svelte:1827,1882-1941` |
| **5. 完整性巡检补洞（`histdata_check`）** | **纯手动**：须调用 `GET .../check` + `POST .../check/fill` | **唯一能彻底补齐的机制**，通过 `histdata_job` 队列分页断点续传补洞，但**未接入任何定时调度**；且美股 Yahoo `1m` 超过 30 天历史上限则永久无法补回。 | `histdata_check.rs`、`data_gaps.rs`<br>`histdata_api.rs:3167-3363`<br>`histdata/caps.rs:809-812` |

---

## C. 信息中枢能力矩阵（第二条线）

### C.1 信息中枢能力总矩阵

| 能力域 | 现状（含 `file:line`） | 核心缺口 | 优先级 |
| --- | --- | --- | --- |
| **新闻采集与多看板管理** | 支持 RSS + 自定义 JSON API（支持 JSONPath 映射与加密密钥注入）、多新闻看板启停、每源 `30s–24h` 轮询、`Retry-After` 退避（`otw-feeds/src/lib.rs`、`otw-scheduler/src/lib.rs`、`feeds_api.rs:154,181`）。 | 单协程串行抓取（1 个慢源阻塞整批 20 源）；无内容正文抽取；无 TTL 清理。 | **P2**（交 Hermes 主管采集） |
| **新闻去重、判级与结构化关联** | 仅单源内 `UNIQUE(feed_id, dedup_key)` 精确去重（`dedup_key=id\|\|link\|\|title`）；Watchlist 读时用正则匹配标题（`otw-feeds/src/lib.rs:180-184,349-353`、`otw-store/src/feeds.rs:286`、`otw-store/src/watchlists.rs:573-633`）。 | **无跨源去重、无 URL 归一化、无标题相似度去重、无重要度/情绪打分、无事件分类、无落库 `tickers[]` 关联表、无新闻关键词推送**。 | **P2**（不在 OTW 重造；由 Hermes 判级后写入） |
| **自选股 ↔ 新闻 / 图表 / 看板联动** | Watchlist 行上有新闻未读数角标、Upcoming 财报/分红条、价格告警铃铛、打开图表链接（`WatchlistDetail.svelte:179-191,729-744,817-944`）。 | ① 点标的整行仅高亮，不能原地看新闻+异动；② 角标跨全库匹配 `symbol\|name` 正则，点进 `/news` 却仅搜当前看板 `ILIKE symbol`，经常"角标有数点进去 0 条"；③ Auto 加密行无法开图表，美股硬编码 `1d`；④ Dashboard 自选卡片不可点击跳转。 | **P0** |
| **提醒与告警引擎（RemindMe + 市场告警）** | `RemindMe` 仅纯日程提醒（`reminders_api.rs:60-66`）；市场条件告警分散在 Watchlists（价格/锚定/滚动涨跌幅）、HistViz（闭盘/实时价格+内置/自定义指标+Pine 脚本）、Scanner（多标的闭盘信号）、Portfolios（每日目标位/偏离）。 | ① **五套引擎入口割裂**，无统一告警总览中心；② **全站不支持新闻关键词/突发事件提醒**；③ Watchlist 告警依托轮询频率而非实时 WS。 | **P1**（补统一视图；新闻告警放 Hermes） |
| **通知通道与外部双向联动** | 出站支持 Email(SMTP)、Telegram、Slack、Discord（`notif_send.rs:96-103`、`notif_channels_api.rs:50-55`）；入站 Webhook `POST /api/hooks/{token}` 支持写 `remindme`/`automator`/`histdata`（`webhooks_inbound.rs:56-72`）；完整 MCP 网关覆盖 32 模块（`mcp/catalog.rs:269-302`）；Automator 有 `http` 节点（`automator/nodes/http.rs`）。 | ① `notif_channels` **缺少通用出站 HTTP Webhook**（告警无法直接 POST 给 Hermes）；② 入站 Webhook 不能直接注入结构化新闻/简报到 `feed_items`。 | **P0**（出站 Webhook） / **P1**（入站新闻） |
| **仪表盘小组件体系** | 30 类小组件（120+ 变体），12 列自由网格 + 6 套预设工作区，绝大多数为真实本地 DB 数据（`registry.js:25-653`、`layout.js:49-343`）。 | ① `economics` 为纯外部 TradingView iframe（离线/受限网失效）；② `histviz` 无内嵌图表仅文本链接；③ `WatchlistWidget` 同步假绿灯、`HistdataWidget` 失败状态字 Bug；④ 卡片间无联动（点标的无法联动其他卡片）。 | **P0**（修 2 个 Bug） / **P2**（组件增强） |

---

### C.2 问题 1：新闻 / 资讯全链路逐环体检

| 环节 | 实现方式（`file:line`） | 算法 / 规则细节 | 现状评价与缺口 |
| --- | --- | --- | --- |
| **1. 采集（Collect）** | `otw-scheduler/src/lib.rs:17,75,80-86` + `otw-feeds/src/lib.rs:116-130` | 每 `10s` 从 `started=true` 看板领取最多 `20` 个到期源（`otw-store/src/feeds.rs:179-206`），**单协程顺序拉取**；支持 RSS/Atom 与 JSON API 路径抽取；仅 429/503 遵守 `Retry-After`。 | **缺口**：1 个超时源（默认请求超时）拖慢整批 20 源；无 ETag/`If-Modified-Since` 增量抓取；无正文抓取。 |
| **2. 去重（Dedup）** | `otw-feeds/src/lib.rs:180-184,349-353` + `otw-store/src/feeds.rs:286` | `dedup_key = guid \|\| link \|\| title`，落库 `ON CONFLICT (feed_id, dedup_key) DO NOTHING`。 | **缺口**：仅单源精确去重。同一突发消息被 Reuters/CNBC/CoinDesk 转载会原样出现 3 次；URL 带 UTM 参数变动即去重失败；无标题指纹/SimHash。 |
| **3. 归类 / 打分 / 关联** | `otw-store/src/feeds.rs` + `otw-store/src/watchlists.rs:573-633` | 仅有静态 `source_name`/`source_type` 与多看板分组；标的关联靠 Watchlist 查询时动态跑 PG 正则 `\mSYMBOL\M`（区分大小写，len≥2）或 `\m公司简称\M`（忽略大小写）匹配 `feed_items.title`。 | **缺口**：无重要性分级（P0/P1/噪音）、无情绪/主题分类、无实体消歧（`AI`/`ON`/`COIN`/`SOL` 误匹配率高）、无正文检索、无 `pg_trgm` 索引导致数据大时慢。 |
| **4. 展示（Display）** | `frontend/src/routes/news/+page.svelte:154,188-192,232-242` + `NewsWidget.svelte:24-44` | `/news` 页支持按看板/来源/类型/关键字/时间筛选，200 条/页游标分页，60s 自动重载 + SSE "有新条数"提示胶囊；Dashboard `NewsWidget` 每 12s 轮询，仅能选单个 `feed_id` 或全部。 | **缺口**：无已读/未读单条标记、无收藏/归档、无按自选股一键过滤面板、无重要新闻置顶。 |
| **5. 推送（Push）** | `otw-scheduler/src/lib.rs:38-42,154-158` + `notif_channels_api.rs:33-37` | SSE `/api/feeds/stream` 仅广播 `{feed_id, feed_name, new_items}` 计数；`NOTIF_MODULES` **完全不含 `feeds`/`news`**。 | **缺口**：**零主动推送能力**，不支持关键词命中推送到 Telegram/Email/站内通知。 |

---

### C.3 问题 2：自选股（Watchlists）与新闻、图表、仪表盘联动体检

> 核心检验：**能不能做到「点 NVDA 看它最近的新闻 + 异动提醒」？**
> 结论：**目前只能做到约 35%（割裂跳转，无法原地聚合，且存在新闻漏匹配 Bug）**。

| 联动路径 | 当前真实交互行为（`file:line`） | 体验断点与缺陷 |
| --- | --- | --- |
| **点击 NVDA 整行** | `selectRow()` 仅切换当前行边框高亮（`WatchlistDetail.svelte:551-554,802`）。 | **无抽屉 / 侧栏详情面板**：看不到近期新闻列表、看不到已设告警详情、看不到实时分时小图。 |
| **Watchlist → 新闻** | 行内若有新匹配标题则显示蓝色数字角标 `newsCounts[item.id]`；点击调用 `openNews(item)` 将 `{q: item.symbol}` 写入全局偏好并跳转 `/news`（`WatchlistDetail.svelte:179-184,817-821`）。 | **双重口径错配 Bug**：① 后端 `news_counts` 扫描**全库所有 feed** 且同时匹配 `symbol` 和去后缀公司名（如 `NVDA` 或 `NVIDIA`）（`otw-store/src/watchlists.rs:618-624`）；② 跳到 `/news` 后却受限于**当前选中的新闻看板**且只搜 `q="NVDA"`（不搜 `NVIDIA`），导致经常出现「NVDA 角标显示 4 条，点进去显示 0 条」。此外 `news_counts` 不随 30s 自动刷新更新（`:148`）。 |
| **Watchlist → 异动提醒** | 行尾铃铛按钮打开 `AlertsModal.svelte`（支持价格突破、锚定/滚动涨跌幅 `%`/`$` 告警，可直发 Telegram/Email）；买/卖目标价旁也有一键转告警铃铛（`WatchlistDetail.svelte:205-210,881,889,928-937`）。 | 仅管理**该标的自选轮询告警**，看不到在图表里设的指标/实时 WS 告警，也不支持新闻关键词异动提醒。 |
| **Watchlist → 图表** | 行尾 K 线图标跳转 `/histviz?provider=...&asset_type=...&ticker=...&tf=1d`（`WatchlistDetail.svelte:186-191,938-944`）。 | ① 硬编码 `tf=1d`，无法记忆常用周期（如永续常用 `15m`/`1h`）；② Auto 模式加密（CoinGecko）`charts[item.id]` 为空，按钮永久置灰（`watchlists/quotes.rs:389,924`）。 |
| **Dashboard ↔ Watchlist** | `WatchlistWidget` 展示报价/涨跌幅榜/最佳最差/单标的 Sparkline/临近触发告警（`WatchlistWidget.svelte:129-269`）。 | ① 卡片内标的纯静态文本，**不可点击跳转图表/新闻/详情**；② 卡片间无联动广播（选中某标的不能同步刷新旁边的 News/Fundamentals 卡片）。 |

---

### C.4 问题 3：提醒体系（RemindMe + 市场告警）与出站能力体检

| 提醒/告警模块 | 触发条件类型 | 检查机制与延迟 | 推送通道 | 代码位置 (`file:line`) |
| --- | --- | --- | --- | --- |
| **RemindMe** | **仅时间调度**：`once` / `interval` / `daily` / `weekly` / `monthly` / `yearly`（关联 `goal`/`todo`/`custom`）。**不支持任何价格、涨跌幅、指标、新闻条件**。 | 后台每 `60s` 扫描到期提醒写入 `notifications` 并派发 | 站内通知 + Email / Telegram / Slack / Discord（支持指定通道） | `reminders_api.rs:60-66`<br>`reminder_job.rs:18-45`<br>`0016_reminders.sql:9-31` |
| **Watchlists Alerts** | **价格阈值**（`above`/`below`）；**涨跌幅 `%` / 涨跌额 `$`**（支持 `anchor` 设定时锁基准 + 截止期，或 `rolling` 滚动回看窗口），支持重复+冷却期。 | 随自选表轮询触发（Auto 最快 `60s`，Connector 最快 `5s`），**非实时 WS** | 站内 + Email / Telegram / Slack / Discord | `watchlists/alerts.rs:40-61`<br>`otw-store/src/watchlist_alerts.rs:17-27,293-321` |
| **HistViz Chart Alerts** | **最强大**：价格交叉、内置/自定义指标、Pine 脚本绘线、定时 `at_time`；支持 3 模式：`background`（闭盘分钟+3s）、`app`（有开页时走实时 WS）、`background_live`（7×24 实时 WS，断流 `120s` 主动发失明通知）。 | `background` 每分钟+3s 闭盘判；`background_live` 秒级/tick 级（指标节流 `1s`） | 站内 + Email / Telegram / Slack / Discord | `histviz_alerts.rs:50-119`<br>`histviz_live_alerts.rs:56-71` |
| **Scanner Signals / Alerts** | 多标的批量形态/事件信号（如 Pin Bar、开盘涨跌幅 `move_from_open` 等），闭盘评估。 | 后台定时闭盘评估（`scanner_job`） | 站内 + 共享通知通道 | `scanner_job.rs:1-250`<br>`mcp/catalog.rs:390-396` |
| **Portfolios Alerts** | 目标位计划价（每小时检查）、持仓偏离/集中度/日报汇总（每日检查）。 | 每小时 / 每日 | 站内 + 共享通知通道 | `portfolios/alerts.rs` |
| **新闻关键词 / 突发提醒** | **完全缺失**。 | 无 | 无 | `notif_channels_api.rs:33-37`（无 `feeds`/`news` 模块） |
| **出站渠道短板** | 已实现 4 种：`email`（SMTP）、`telegram`（Bot API）、`slack`、`discord`。 | 派发失败记 `last_error`（无队列重试） | **缺失通用出站 HTTP Webhook**（需绕道 Automator `http` 节点且无法被 Watchlist/Chart 告警直接触发） | `notif_send.rs:96-103`<br>`notif_channels_api.rs:50-55`<br>`automator/nodes/http.rs:73-179` |

---

### C.5 问题 4：仪表盘全部 30 类小组件审计

> 统计自 `frontend/src/lib/modules/dashboard/widgets/registry.js:25-577`（共 30 类组件）。**绝大多数（28 类）接入真实本地 PG API，仅 1 类为纯外部 iframe，1 类为纯静态文本，无「假数据空壳」，但存在 2 处真实代码 Bug 与若干信息密度/联动短板**。

| 组件 `type` | 数据性质 | 刷新机制 (`file:line`) | 信息密度与可用性评价（聚焦美股+加密信息中枢） | 缺陷 / 备注 |
| --- | --- | --- | --- | --- |
| **`economics`** | **纯外部 iframe**（TradingView JS 注入） | 依赖外部 `s3.tradingview.com`（`EconomicsWidget.svelte:20-33`） | ★★☆☆☆ 视觉完整但硬编码英文 `locale:'en'`，断网/国内网络/严格 CSP 下直接空白，无法与 OTW 标的或提醒联动。 | **唯一纯 iframe 组件**（全前端另一处 `<iframe` 在 `MessageReader.svelte:337` 沙盒邮件正文）。 |
| **`watchlists`** | 真数据（7 变体） | `livePulse(6s)` 读本地缓存（`WatchlistWidget.svelte:56`） | ★★★★☆ 密度高（报价/涨跌幅榜/最佳最差/Sparkline/临近告警/资产饼图），**信息中枢核心组件**。 | **Bug**：`sync` 变体 `class:stale={!lastQuoted}` 恒绿灯（`:200-203`）；所有行不可点击跳转；6s 轮询过密。 |
| **`news`** | 真数据（2 变体） | `livePulse(12s)` 读 `/api/feed-items`（`NewsWidget.svelte:24-44`） | ★★★☆☆ 列表紧凑可外链，但配置过弱。 | 仅支持选单 `feed_id` 或全部；不能选新闻看板、不能按标的/关键词过滤、不用 SSE。 |
| **`scanner`** | 真数据（3 变体） | 每 `60s` 读 `/api/scanner/board`（`ScannerWidget.svelte:23,79`） | ★★★★★ **信息密度最高**：蜂窝热力图、归一化折线群、自定义列表，极适合美股+OKX 一屏扫盘。 | 明确非实时（仅闭盘缓存），点详情须进 `/scanner`。 |
| **`fundamentals`** | 真数据（8 变体） | `livePulse(300s)` 纯读本地快照（`FundamentalsWidget.svelte:2,26`） | ★★★★★ **质量极佳**：宏观看板、财报日历、SEC 公告、同行估值对比，且自带 `stale` 过期提示与详情深链。 | 仅覆盖美股/宏观（需先在模块内抓取入库）。 |
| **`portfolios`** | 真数据（13 变体） | `livePulse(6s)`（`PortfolioWidget.svelte:29`） | ★★★★☆ 净值曲线、配置饼图、现金比、持仓表完整。 | 后端每天才刷 1 次价，前端 6s 轮询属空转；且不支持 OKX 估值。 |
| **`histdata`** | 真数据（7 变体） | **仅挂载拉 1 次，无自动刷新**（`HistdataWidget.svelte:24-39`） | ★★★☆☆ 数据集总量/磁盘/缺口/最久未更新视图很有运维价值。 | **Bug**：`queue`/`failures` 过滤 `j.status === 'failed'`（`:53,60`），但 DB 存 `'error'`（`0021_histdata.sql:84`），失败列表恒空！ |
| **`histviz`** | 真数据（4 变体，**无图表**） | **仅挂载拉 1 次，无自动刷新**（`HistvizWidget.svelte:26-39`） | ★★☆☆☆ 名为 "Charts" 却**不能渲染 K 线图**，仅展示工作区列表和图表告警列表，且点工作区只跳裸 `/histviz`。 | 易误解为空壳；实际仅 `alerts`/`triggered` 两个告警变体对信息中枢有用。 |
| **`quant`** | 真数据（6 变体） | `livePulse(300s)` 纯读本地计算（`QuantWidget.svelte:2,21`） | ★★★★☆ 风险/VaR、相关性矩阵、波动率锥、HMM 市场状态（Calm/Turbulent）含金量高。 | 依赖本地已存足够长历史数据。 |
| **`webhooks`** | 真数据（4 变体） | **仅挂载拉 1 次**（`WebhooksWidget.svelte:30-48`） | ★★★★☆ `lastSeen` 静默告警检测（超过 `quietHours` 标红）非常适合监控 Hermes 推送是否断流！ | 缺少 `livePulse` 自动刷新。 |
| **`automator`** | 真数据（6 变体） | `livePulse(3s)`（`AutomatorWidget.svelte:31`） | ★★★★☆ 运行态/日程/成功率/失败日志/一键触发完整。 | `3s` 轮询对单用户本地略频，无运行任务时可放宽。 |
| **`remindme-stats`** / **`remindme`** | 真数据（6+1 变体） | `livePulse(6s)`（`RemindStatsWidget.svelte:30`） | ★★★☆☆ 未读通知流 `feed` 变体可充当站内全局告警收件箱（汇聚各模块写入 `notifications` 的消息）。 | `remindme` 仅快捷建定时提醒表单。 |
| **`mportfolios`** | 真数据（4 变体） | 仅挂载拉 1 次（`MportfoliosWidget.svelte:27-46`） | ★★★☆☆ 跟踪 Dataroma 13F 机构调仓（美股长线参考）。 | 源码自注不含基准收益曲线（`:6-8`）。 |
| **`findb`** | 真数据（4 变体） | 仅挂载拉 1 次（`FindbWidget.svelte:25-40`） | ★★☆☆☆ 仅展示标的库收藏分类和快照更新提示，信息中枢价值低。 | — |
| **`journal-stats`** / **`journal`** | 真数据（15+1 变体） | `livePulse(6s)`（`JournalStatsWidget.svelte:77`） | ★★★☆☆ 交易日志复盘统计完整，但属复盘而非行情信息中枢。 | — |
| **`backtest`** / **`agent`** / **`agent-stats`** / **`mailbox`** / **`calendar`** / **`wealth`** | 真数据 | `mailbox`(12s)、`calendar`(30s)，余下挂载拉 1 次 | ★★★☆☆ 各为对应模块真实聚合，其中 `mailbox`（研报/告警邮件）与 `agent`（快捷问答）可辅助信息中枢。 | `wealth`/`backtest`/`agent` 均读真实后端 API。 |
| **`editor`** / **`goals`** / **`todos`** / **`routines`** / **`mindset`** / **`time`** / **`subscriptions`** / **`prompts`** / **`resources`** / **`community-docs`** / **`taxcalc`** | 真数据（11 类生产力/财务组件） | 按各自模块 API 读取（`registry.js:37-576`） | ★★☆☆☆ 属个人笔记/效率/税务周边，与实时市场信息中枢弱相关，全部为真实本地数据。 | — |
| **`text`** | 静态文本 | 无 API（`TextWidget.svelte:2-25`） | ★★☆☆☆ 仅用于仪表盘分区标题或手动备忘录。 | 非空壳，定位即分区标题/便签。 |

---

### C.6 问题 5：与外部系统（Hermes 侧：RSS 采集 + 每日简报）的互补分工

既然 Hermes 侧已经跑通 **RSS 采集 + 每日简报**，最忌讳在 OTW 里重复维护一套脆弱的 RSS 抓手与简报生成链路。二者应严格解耦为 **「Hermes 管非结构化情报，OTW 管结构化行情与盘面」**：

| 职责领域 | 建议归属 | 理由与 OTW 现有对接抓手 (`file:line`) |
| --- | --- | --- |
| **RSS / 社媒 / 公告抓取、跨源去重、AI 判级/摘要、新闻关键词提醒、每日简报** | **Hermes 主管** | OTW `otw-feeds` 无跨源去重、无打分、无关键词推送、无 TTL 清理；Hermes 已有完整管线，在 OTW 重造纯属双倍运维。 |
| **美股 + OKX 永续/现货实时行情、历史 K 线库、技术指标/盘面图表、价格/指标/波动率异动告警** | **OTW 主管** | OTW 的多路复用 WS、Canvas 图表、Pine/自定义指标引擎、7×24 `background_live` 告警与 Scanner 蜂窝看板是强项，Hermes 不必重写行情引擎。 |
| **Hermes → OTW 推送（简报/高优新闻/宏观事件入屏）** | **单向推送桥** | ① 立即可用：用 OTW 现有入站 Webhook `POST /api/hooks/{token}` 将 Hermes 筛选出的 **P0 级突发新闻/每日简报摘要** 写入 `remindme`（进入 OTW 站内通知收件箱 `RemindStatsWidget.feed`）或触发 `automator`（`webhooks_inbound.rs:56-72`）；② 进一步（可选 P1）：允许 Hermes 通过 MCP 或新增 1 个 `POST /api/feed-items/ingest` 接口，只向 OTW 写入「已去重、已打标（含 ticker + 级别）」的精选资讯，彻底关闭 OTW 自己的 RSS 轮询器。 |
| **OTW → Hermes 回传（价格/指标异动触发深度研判）** | **事件回调 + MCP 只读查询** | ① 补齐 OTW **出站通用 Webhook 渠道**后，OTW 的价格/RSI/均线/Scanner 告警可秒级 POST 到 Hermes，触发 Hermes 检索该标的最新新闻并生成「价格异动+消息面归因」合并推送到 Telegram；② Hermes 可直接调用 OTW **只读 MCP 网关**（`POST /api/mcp`，按模块授 `"r"` 权限，`mcp/catalog.rs:28-29,269-302`）读取自选表、组合持仓、K 线与基本面快照，用于每日简报自动结合当前关注标的！ |

---

## D. 三条最值得先做的事（P0）

| 序号 | 事项名称 | 涉及文件与行号 | 具体改法 | 验收标准 | 预计工时 |
| --- | --- | --- | --- | --- | --- |
| **P0-1** | **修复 OKX WS 保活死代码 + 补齐前端新鲜度/Stale 与 2 个看板状态 Bug** | • `core/otw-core/src/live/mod.rs:554-571,621-625`<br>• `core/otw-core/src/histdata_api.rs:414`<br>• `frontend/src/lib/modules/histviz/Pane.svelte:1761-1764,2440-2466`<br>• `frontend/src/lib/modules/dashboard/widgets/WatchlistWidget.svelte:197-215`<br>• `frontend/src/lib/modules/dashboard/widgets/HistdataWidget.svelte:52-63` | 1. 删除 `live/mod.rs:570` 的 `continue;`，让 5s `idle_check` 每次落到 `:621` 调用 `feed.drain_sends()`，激活 OKX 20s `"ping"`；<br>2. `histdata_api.rs:414` 收到 `BroadcastStream` `Lagged` 时下发 `status(retrying/resync)` 事件，前端收到后调用 `checkTail()`；<br>3. `Pane.svelte` 增加 `lastBarRecvAt` + 1s 计时器，顶栏显示距上次更新秒数，WS >30s 或轮询 >2.5×`poll_secs` 未更新时圆点变橙并标「延迟/Stale」；<br>4. `WatchlistWidget.svelte:200` 改为 `Date.now() - Date.parse(lastQuoted) > (list.refresh_secs * 2000)` 才算 stale；<br>5. `HistdataWidget.svelte:53,60` 将 `'failed'` 修正为 `['error', 'partial'].includes(j.status)`。 | 1. 订阅冷门 OKX 永续对（如小币种 `1m`），静默观察 2 小时日志无 `ws closed`/`30s timeout` 断线；<br>2. 断网 35 秒后图表 K 线立即由绿转橙并显示「已停更 35s」；<br>3. Watchlist 停止同步超 `2×refresh_secs` 后 Dashboard 同步卡变灰/橙；<br>4. 触发一次错误下载任务，Dashboard 失败卡准确显示该条报错。 | **6–8 h** |
| **P0-2** | **打通 OKX 永续/现货跨模块统一取价与 Watchlist「点标的看新闻+异动」闭环** | • `core/otw-core/src/watchlists/quotes.rs:389,697-712,757-776,924`<br>• `core/otw-store/migrations/0214_portfolio_okx_provider.sql`（新迁移）<br>• `core/otw-core/src/portfolios/prices.rs:324-335`<br>• `core/otw-store/src/watchlists.rs:606-633`<br>• `core/otw-core/src/watchlists_api.rs:814-827`<br>• `frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:179-191,551-554,802`<br>• `frontend/src/lib/modules/dashboard/widgets/WatchlistWidget.svelte:254-265` | 1. `watchlists/quotes.rs:697-712` 为 `"okx"` 增加默认 ticker 转换（优先查 connector 的 `market` 配置，永续→`{SYM}-USDT-SWAP`，现货→`{SYM}-USDT`）；`quote_via_connector` 优先读 `LiveHub` 内存快照或 OKX `/market/ticker`，避免拉 3h `1m` 闭盘 K 线；<br>2. 新增迁移放宽 `portfolio_assets.spot_provider` CHECK 允许 `'okx'`，并在 `portfolios/prices.rs` 增加只读 OKX `/api/v5/market/ticker` 取价；<br>3. 新增 `GET /api/watchlists/items/{id}/news`（复用 `news_patterns` 返回该标的最近 10 条匹配新闻），点击 Watchlist 任意行（如 `NVDA` / `BTC`）右侧/下方展开轻量详情抽屉：**最近新闻 + 当前已设告警/一键加告警 + 一键进图表（记住上次周期）**；同时修复点击角标跳 `/news` 时清掉看板隔离或带入 `symbol`+`name`；<br>4. `WatchlistWidget` 标的单元格增加点击链接直达对应自选列表/图表。 | 1. 自选表选择 OKX 永续连接器添加 `BTC`/`ETH`/`SOL`，无需手改 ticker 即可 2s 内出实时永续价，且与图表误差 <0.05%；<br>2. 组合资产 `spot_provider` 可选 `okx` 并正常刷新估值；<br>3. 在 Watchlists 页面单击 `NVDA`，0 次跳页即可看到近期匹配新闻列表 + 告警状态，且新闻条数与角标严格一致。 | **12–16 h** |
| **P0-3** | **打通 OTW→Hermes 通用出站 Webhook + 补齐断网补洞、数据老化清理与健康观测** | • `core/otw-core/src/notif_channels_api.rs:50-55`<br>• `core/otw-core/src/notif_send.rs:96-103`<br>• `core/otw-core/src/histdata_refresh.rs:241-245,292-318`<br>• `core/otw-core/src/live/hub.rs:1114-1215`<br>• `core/otw-core/src/main.rs:433-436,806-844`<br>• `core/otw-store/src/histdata.rs:767-777`<br>• `deploy/docker-compose.yml:222-248` | 1. `notif_channels` 新增 `webhook` 通道类型（复用 `automator/nodes/http.rs` 的 SSRF 校验 + `allow_internal` 选项，支持自定义 Header/Bearer，POST 标准 JSON `{module, title, details, url, fired_at}`），让 Watchlists/Chart/Scanner 告警直连 Hermes；<br>2. 改造 `histdata_refresh.rs`：从 `dataset.range_to` 动态计算缺口分页拉取（上限可配如 7 天），失败不覆盖 `last_refresh_at` 并做退避；`live/hub.rs:spawn_seed` 循环分页补齐（设最大页数保护）；<br>3. `main.rs` 每 6h 清理任务增加：`feed_items` 保留 60 天、`notifications` 已读保留 90 天；`otw-store/src/histdata.rs:767` 去掉每次写 K 线的全量 `count(*)`；<br>4. 扩展已登录 `/api/health`（及内网 `/health`）返回：PG 连接池活跃/空闲数、LiveHub 活跃流与断线数、最近 1h 429 计数；<br>5. `deploy/docker-compose.yml` 为 PG18 添加 `shared_buffers=512MB`、`statement_timeout=15000`、`work_mem=8MB`。 | 1. 触发一条 NVDA/BTC 价格告警，Hermes 本地 Webhook 端点在 3s 内收到标准 JSON 回调；<br>2. 模拟断网 72h 后恢复，开启自动刷新的 OKX `5m` / 美股 `15m` 数据集在 1 个周期内自动零空洞补齐；<br>3. `/health` 输出含连接池、LiveHub 状态与限流摘要；<br>4. 插入 10 万条 90 天前 `feed_items` 后运行清理任务，数据被回收且 `EXPLAIN` 显示无全表慢锁。 | **12–16 h** |

---

## E. 不建议做的（重复造轮子 / 维护成本高于收益）

| 不建议做的事项 | 为什么不值得做（证据与收益成本比） | 替代做法 |
| --- | --- | --- |
| **1. 在 OTW 内重造 RSS 跨源去重、AI 新闻打分、每日简报、新闻关键词推送引擎** | OTW `otw-feeds` 仅是极简抓取器（`otw-feeds/src/lib.rs` 无 NLP/去重/推送基础），而 Hermes 侧已经跑通全套采集+简报。在 OTW 维护两套规则与 LLM 调用既浪费 Token 又分裂注意力。 | 关闭 OTW 原生 RSS 轮询，仅保留 Hermes 通过入站 Webhook/精选接口向 OTW 推高价值摘要。 |
| **2. 引入 TimescaleDB / ClickHouse / Redis / Prometheus+Grafana 重型组件** | 宿主机仅 **5 核 11GB RAM**，当前核心栈已占 ~6.6GB 配额（`deploy/docker-compose.yml:67-248`）。个人美股+OKX 中度负载 1 年仅 ~5GB，纯 PG18 加 `512MB shared_buffers` + 老化清理 + 轻量 `/health` 足够跑 3–5 年；上重型中间件只会吃光内存并陡增升级维护成本。 | PG18 参数微调 + 定时 TTL 清理 + `/health` JSON 暴露指标给 Hermes 定时巡检。 |
| **3. 自建财经日历爬虫替代 `EconomicsWidget` 的 TradingView iframe** | 宏观财经日历（CPI/非农/FOMC 预期值、前值、修正值）第三方结构化源要么昂贵要么反爬极严。OTW 已有 `Fundamentals`（FRED 宏观序列 + 美股财报日历，`FundamentalsWidget.svelte:66-138`）。 | 国内/离线环境下隐藏 `EconomicsWidget`，重要宏观事件由 Hermes 日报提醒或写入 OTW `Calendar`（支持 MCP 写入）。 |
| **4. 把 Watchlists 整表改造成全量 WebSocket 推送引擎** | Watchlist 同时支持美股（Yahoo 无免费 WS）和加密，且含 7d/30d/52周高低/RSI/市值等复合指标（`watchlists/quotes.rs`）。整表改 WS 改造成本极高且对美股无效。 | 复用 `LiveHub` 已有 OKX 内存价 + 其余标的保持 HTTP 轮询，并将前端刷新节奏与后端 `refresh_secs` 对齐。 |
| **5. 重构合并 5 套告警数据库表（RemindMe / Watchlist / HistViz / Scanner / Portfolio）** | 5 套告警模型语义差异极大（纯时间 vs 轮询涨跌 vs Pine 脚本跨柱 vs 多标的扫描），强行合一会牵动 20+ 迁移文件、MCP Schema 契约测试与前端 5 个页面，风险远大于收益。 | 保持底层分表不动，仅通过统一出站通知（`notifications` 表 + 通用 Webhook）在展示与出口层汇聚。 |
| **6. 给 Yahoo Finance 做代理池/反爬抓取集群** | Yahoo 非官方接口本身无 SLA 且 `1m` 仅 30 天深度（`histdata/caps.rs:809-812`）。投入精力对抗 429 不如直接配好免费/低价美股官方 API。 | 给 Yahoo 加上 `paced_driver` 限流 + `query2` 备域兜底即可；主力美股盘中建议接入 OTW 已原生支持的 **Alpaca（免费 IEX 含 WS）** 或 **Massive/Polygon** 只读 Key。 |

---

## F. 风险评估（现有数据 / 汉化 / 部署）

| 风险类别 | 具体风险点（含 `file:line`） | 影响评估 | 规避措施 |
| --- | --- | --- | --- |
| **1. 现有数据与迁移风险** | • **禁止修改已有迁移文件**：sqlx 校验历史迁移 checksum，放宽 `portfolio_assets.spot_provider` CHECK 绝不能改 `0037_portfolio_reconcile.sql:25-26`，必须新建 `0214_*.sql`。<br>• **大表加索引/清理锁表**：对已存数百万行的 `histdata_bars` 或 `feed_items` 建索引或大批 `DELETE` 可能阻塞 10 连接池。<br>• **主密钥丢失**：`OTW_SECRET_KEY`（`deploy/.env.example:36-39`）加密所有 Connector/Feed/通知通道密钥，一旦变更或重建 `.env` 导致全量凭证不可解密。 | 若误改旧迁移会致 `otw-core` 启动失败；大批 `DELETE` 阻塞实盘写库；密钥丢失需重配所有 API Key。 | ① 一律新增高编号幂等迁移（`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`）；② 清理任务改分批 `DELETE ... LIMIT 5000`；③ 建新索引使用 `CREATE INDEX CONCURRENTLY`（需独立事务外执行）；④ 改前先 `pg_dump` 备份并妥善冷备 `deploy/.env`。 |
| **2. 现有汉化破坏风险** | • 本仓库刚通过 `ZH_FIX.md` 将 `frontend/src/lib/i18n/zh.json` 补齐至与 `en.json` 完全一致的 **12,164 键**（`missing_keys: 0`、`duplicate_keys: 0`、`empty_values: 0`，`ZH_FIX.md:41-51`）。<br>• Dashboard 小组件名、说明、预设页名采用**两套汉化机制**：除 `zh.json` 外，`registry.js:579-601` 与 `layout.js:108-124` 通过 `labelOf()` 读取 `frontend/src/lib/i18n/labels.zh.json` 按英文原文精确匹配替换。 | ① 新增前端文案（如 Stale 徽章、Watchlist 抽屉、Webhook 通道表单）若只写 `en.json` 漏写 `zh.json`，将破坏 `12164/12164` 完整性并出现英文混杂；② 若改动 `registry.js` 中已有英文标题字符串，会导致 `labels.zh.json` 查表失配瞬间退回英文。 | ① 任何前端文案新增必须**同步补齐 `en.json` + `zh.json`**（保留 2 空格缩进），并用 `ZH_FIX.md` 同款校验脚本确认 `missing_keys == 0`；② 不修改已有 `registry.js`/`layout.js` 英文键，新增文案统一走 `$t('...')` 而非硬编码英文。 |
| **3. 部署与构建风险（5 核 11GB）** | • **镜像切换陷阱**：`deploy/setup.sh:366-374` 默认叠加 `docker-compose.images.yml` 拉取 Docker Hub 预构建镜像；改本地源码后若未用 `--build` 且不去掉 `images.yml`，改动不会生效；反之切自建后失去一键拉上游镜像便利，后续升级上游需 `git rebase/merge`。<br>• **5C/11GB 编译 OOM/卡顿风险**：`deploy/docker-compose.yml:76-77` 显示 `frontend` 镜像构建额外挂载 `core: ../core`（编译 Rust/WASM 脚本引擎），与 `core` 容器的 Rust Release 编译同时跑易吃满 5 核与 11GB 内存，可能拖垮同机运行的 Hermes 或触发 OOM。<br>• **重跑 `setup.sh` 误清数据卷风险**：`deploy/setup.sh:136-170,385-408` 覆盖 `.env` 会重新生成 `POSTGRES_PASSWORD`，与已有 `opentraderworld_postgres-data` 卷冲突导致 `core` 无限重启循环。 | 线上构建可能导致同机服务卡死或 OOM；误跑 `setup.sh` 存在误删数据卷风险。 | ① 绝不重跑 `setup.sh`，始终保留现有 `deploy/.env` 与 `network.env`，升级仅用 `docker compose --env-file .env --env-file network.env build core` 与 `build frontend` **串行分步构建**；② 在构建环境限制并发（如 `CARGO_BUILD_JOBS=2` 或 `docker build --memory=6g`）；③ 所有自研改动控制在独立 git 分支并保持最小侵入面，方便上游版本合并；④ 确认 `deploy/docker-compose.yml:174` 中 `core` 为 `read_only: true` 只读根文件系统，新增代码绝不可向 `/tmp` 以外的容器本地路径写文件。 |
