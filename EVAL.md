# OpenTraderWorld 个人交易工作台深度评估报告

> 评估基线：仓库当前 `HEAD`（`1bd971b`，基于上游 `v0.1.6` 叠加 5 个本地提交：中文化补齐、注册表 `labelOf` 改造与 `21eef76` 券商合约持仓合并）。  
> 评估锚点：单人自托管、法国 VPS（5 核 / 11 GB 内存、Docker 部署）、已做中文汉化、标的为 **美股（主力）+ A股 + 加密（OKX 永续为主）**、诉求为「实盘持仓 + 看行情 + 跑回测 + 记交易 + 抓新闻」、拒绝空壳模块、愿购少量 API Key 但不愿多市场重复订阅。  
> 已知环境事实：部署机访问东财 `push2his` 不通；新浪 `hq.sinajs.cn` 与腾讯 `qt.gtimg.cn` 可用。  
> 证据纪律：凡无源码直接支撑的外部接口/商业价格/运行时推断均显式标注 **「推测」**。

---

## 1. 一句话结论

**这套框架整体工程质量高、核心模块扎实，对「美股（研究/回测/记账）+ 加密现货/主流永续行情」非常合适，但对你「三市场合一 + OKX 永续为主 + A股」的现状属于「美股可用、OKX 半残、A股原生缺失」——最缺的三件事依次是：① 永续合约全链路数据模型（强平价/资金费率/标记价/保证金与非长仓台账），② A股低成本直连行情与复权日K通道（绕开不可达的东财接口），③ 组合与自选表对多市场源（OKX/自定义源）及非 USD 计价的统一打通。**

- **为什么值得继续用**：Rust 单体 `otw-core` + PostgreSQL 18 + SvelteKit 架构干净、内存可控（`deploy/docker-compose.yml:67,176,198,247` 默认限额合计约 6.6 GB，5 核 11 GB 充裕），回测引擎已演进到 v7 并带无未来函数审计、Pine v5/v6 脚本引擎与下钻撮合（`core/otw-core/src/backtest/mod.rs:47-100`），交易日志支持通用多语 CSV 映射 + 券商 API 同步（`core/otw-core/src/journal_import/mod.rs:1-13`），新闻模块内置 RSS + 通用 JSON API 采集器（`core/otw-feeds/src/lib.rs:3-6`）。
- **为什么现在还不能直接爽用**：
  1. **OKX 永续风险字段全链路缺席**：从底层模型到前端均无强平价、资金费率、保证金率（`core/connectors/model/src/event.rs:224-253`、`core/otw-core/src/brokers/mod.rs:177-214`、`frontend/src/lib/modules/histviz/BrokerTabs.svelte:402-415`）；且你本地提交 `21eef76` 把 OKX 合约并入 Portfolio Tracker 后，因台账是**纯现货做多模型**，空头合约会被截断归零并记为虚增已实现盈利，多头合约则会与 USDT 保证金余额双重计价（`core/otw-store/src/portfolios/ledger.rs:108-126,174-189`、`core/otw-store/src/portfolios.rs:874-927`）。
  2. **A股原生无连接器、无深交所日历、基本面被 SEC EDGAR 锁死**：仓库内零国内源，`calendars.json` 只有上交所 `XSHG` 缺深交所 `XSHE`（`core/otw-core/src/exchanges/calendars.json:393-445`），基本面开户强制校验 SEC CIK（`core/otw-core/src/fundamentals_api.rs:486-505`），自定义 HTTP 源又只解析 JSON 无法直连新浪/腾讯 GBK 文本（`core/otw-core/src/histdata/kinds/http.rs:1,728-799`）。
  3. **Portfolio / Watchlists 定价引擎与 Connector 体系割裂**：组合定价硬编码仅允许 `coingecko` + `yahoo`（及少量现货所，不含 `okx` 与自定义源，`core/otw-core/src/portfolios/prices.rs:319-336`、`core/otw-core/src/portfolios_import/mod.rs:41`）。

---

## 2. 架构速览

### 2.1 Rust 后端（`core/`）Workspace 模块划分

整个后端在 `core/Cargo.toml:1-20` 声明了 16 个 workspace crate，但**实际业务逻辑高度集中在单体 `otw-core` 与 `otw-store` 中**，有 5 个 crate 是 Phase 0 空壳占位符：

| 层级 | Crate 路径 | 实际状态与职责 | 代码证据 |
| :--- | :--- | :--- | :--- |
| 应用单体 | `core/otw-core` | Axum HTTP/SSE/WS 服务，内含 ~150 个子模块（行情、回测、组合、日志、券商、基本面、扫描、机器人、MCP、自动流等），全局使用 `mimalloc` 与并发计算闸门 `compute_gate` | `core/otw-core/src/main.rs:7-159,342-343,683-696` |
| 持久化层 | `core/otw-store` | SQLx + PostgreSQL 18 数据访问层，连接池上限 10，启动自动执行 `sqlx::migrate!("./migrations")`（213 个迁移文件） | `core/otw-store/src/lib.rs:109,114` |
| 连接器框架 | `core/connectors/{model,sdk,engine,providers,testkit}` | 规范化交易所/数据源抽象：`model` 管统一类型与能力 TOML，`sdk` 管 HTTP/WS Driver 与签名，`engine` 管订单状态机与 K 线聚合，`providers` 放各交易所/数据商具体实现 | `core/connectors/providers/src/lib.rs`、`core/connectors/sdk/src/native.rs` |
| 专项库 | `otw-feeds` / `otw-scheduler` / `otw-script` / `otw-script-wasm` | RSS+JSON 新闻抓取器；定时轮询调度器；Pine v5/v6 脚本 VM（同时编译为前端 WASM 供图表本地运行） | `core/otw-feeds/src/lib.rs:1-62`、`frontend/Dockerfile:12-21` |
| **空壳占位** | `otw-modules` / `otw-queue` / `otw-runner` / `otw-i18n` / `otw-theme` | **均为 9 行 Phase 0 Stub**，仅导出一两个空结构/常量，无运行时代码 | `core/otw-*/src/lib.rs:1-9` |

### 2.2 前端模块注册表与汉化挂载方式

- **静态注册表驱动**：`frontend/src/lib/modules/registry.js:14-268` 以数组静态注册 **34 个模块**（`dashboard` + 33 个功能模块），每个模块声明 `id`、`name`、`route`、`category` 及 `requires` 依赖链（例如 `histviz`/`backtest`/`scanner`/`quant` 依赖 `histdata`，`robots` 依赖 `backtest`，`webhooks` 依赖 `remindme`）。
- **动态按需开关**：侧边栏、工作区预设（`frontend/src/lib/modules/dashboard/layout.js:49-106`）、Dashboard 小组件（`frontend/src/lib/modules/dashboard/widgets/registry.js:25-120`）均以模块启用状态过滤显示；不需要的模块可在设置中关闭而无需删代码。
- **本地中文汉化接入点**：
  - `frontend/src/lib/i18n/zh.json` 补齐 379 个词条并修复占位符误译（`ZH_FIX.md:1-52`）；
  - `frontend/src/lib/i18n/labels.js:1-34` + `labels.zh.json`（457 行）提供 `labelOf()` 动态查表；
  - 在 `registry.js:270-277`、`dashboard/layout.js:108-120`、`widgets/registry.js` 中通过 `Object.defineProperty` 劫持模块/预设/小组件的 `name`/`description` getter，配合 `+layout.svelte` 与 `ModuleSwitcher.svelte` 的 `$locale` 响应式依赖实现全界面中文切换。

### 2.3 数据层 Connector 怎么接（双轨 + 自定义扩展）

OpenTraderWorld 的数据接入分为 **三条通道**：

1. **统一连接器框架（历史 K 线 + 实时流 + 券商账户）**：
   - `core/connectors/providers` 实现各数据源/交易所的 `Mapper` / `TradeMapper` 与 `capabilities*.toml`；
   - `core/otw-core/src/histdata/native.rs:1-120` 与 `histdata/caps.rs` 将其桥接为 `histdata::Connector` trait，供历史下载任务（`histdata_job`）、图表实时流（`live::hub::LiveHub`，`core/otw-core/src/live/mod.rs:1-28`）、无 WS 源的 REST 轮询流（`live::poll`，最小 5s / 默认 15s，`core/otw-core/src/live/poll.rs:36-38`）使用；
   - `core/otw-core/src/brokers/{native,native_trade,caps}.rs` 将同一套 provider 桥接为 `Broker` trait，供账户余额/持仓/委托/成交读取与下单使用。
   - 权限治理采用「Data Broker / 授权到模块」模式（`histdata_connectors` 表 + 模块白名单）。
2. **配置驱动自定义数据源（无需写 Rust 即可扩展）**：
   - **Custom HTTP（`http` kind）**：通过 JSON Path 映射任意 JSON REST 接口为 OHLCV K 线或宏观序列，支持 `daily_tz`（如 `Asia/Shanghai`）、`poll_secs` 准实时轮询、`allow_private_hosts`（允许访问同机 Docker sidecar）（`core/otw-core/src/histdata/kinds/http.rs:1,222,274,728-799`），通过 `Capability::runtime` 动态注册（`core/otw-core/src/histdata/caps.rs:844-927`）。**限制：仅支持 JSON，不支持 GBK/JS 文本**。
   - **Custom Push（`push` kind）**：配合入站 Webhook `POST /api/hooks/{token}`（目标 `histdata`，`core/otw-core/src/webhooks_inbound.rs:67-71,86-89`），允许外部脚本主动推送 K 线或实时 tick 到数据库并广播给前端图表。
3. **独立直连通道（与 Connector 框架割裂）**：
   - **Portfolio Tracker 定价**：绕开 Connector 框架，硬编码只调 CoinGecko、Yahoo、Binance、Kraken、Coinbase（`core/otw-core/src/portfolios/prices.rs:1-15,319-336`），导入向导白名单甚至仅限 `["coingecko", "yahoo"]`（`core/otw-core/src/portfolios_import/mod.rs:41`）。
   - **Watchlists 行情**：默认走 Yahoo / CoinGecko，可选绑定一个 `histdata` Connector 拉 70 天日线 + 1m 最新收盘（`core/otw-core/src/watchlists/quotes.rs:1-13,717-788`）。
   - **Fundamentals 基本面**：通过 `fundamentals::connectors()` 注册 21 个独立基本面/宏观连接器（EDGAR、FRED、Treasury、ECB、FINRA、FMP、Finnhub、Quiver 等，`core/otw-core/src/fundamentals/mod.rs:43-67`），叠加 Alpha Vantage/EODHD/Massive 复用 Key（`core/otw-core/src/fundamentals/vendors.rs:1-4`）。

### 2.4 行情与持仓数据流向总览

| 业务场景 | 数据来源路径 | 实时性/刷新机制 |
| :--- | :--- | :--- |
| 图表（HistViz）实时 K 线 | `LiveHub` 管理 WS 连接（OKX/Binance/Alpaca/Massive/IBKR 等）；无 WS 源（Yahoo/EODHD/Custom HTTP）走 `live::poll` 定时拉 REST；首次打开用 REST 预热 `SEED_BARS=300` 根 | WS 毫秒~秒级 SSE/WS 推前端；轮询源最低 5s、默认 15s（`live/mod.rs:56`、`live/poll.rs:36-38`） |
| 实盘账户面板（图表下方的 BrokerTabs） | 走 `brokers::Broker`（`accounts` / `positions` / `orders` / `holdings`），带短期内存缓存与私有 WS 刷新 | 秒级~分钟级实时读取，**直接展示券商原生持仓与未实现盈亏**（`frontend/src/lib/modules/histviz/BrokerTabs.svelte:402-415`） |
| 投资组合（Portfolio Tracker） | 从 `portfolio_operations` 台账重放计算持仓；可从券商导入余额（+ 本地 `21eef76` 合并的合约持仓）生成差额买卖流水；价格统一换算为 USD 存 `last_price_usd`，读时再用 `journal_fx` 折算为组合币种 | 按日快照 + 手动/定时刷新；汇率取自免费 Frankfurter/ECB + er-api 备份（含 `CNY`/`HKD`，`core/otw-core/src/fx.rs:17-18`、`core/otw-store/src/journal_fx.rs:21-23`） |
| 交易日志（Trading Journal） | 手动录入 / 通用 CSV 智能列映射导入 / 券商 API 拉取成交（`executions`）按 `fold_fills` 折叠为开平仓往返 | 定时或手动同步；OKX/Binance Futures/TradeStation API 仅提供近 90 天成交，更早需 CSV（`brokers/caps.rs:110,798,849`） |
| 新闻流（News） | `otw-feeds` 定时轮询用户配置的 `rss` 或 `api` 源，落库 `feed_items`，通过 `/api/feeds/stream` SSE 推送 | 30s ~ 86400s 可配，默认 900s，支持 `Retry-After` 退避（`feeds_api.rs:56,154,181`、`otw-feeds/src/lib.rs:76-112`） |

### 2.5 本地存储、缓存与 5 核 11 GB VPS 资源评估

- **持久化存储**：全部业务数据（K 线、持仓流水、日志、新闻、财报、回测历史、加密凭证）均存单实例 **PostgreSQL 18**；上传文件（截图/附件）落 Docker volume `/data/uploads`（`deploy/docker-compose.yml:127`）。
- **多级缓存体系**：
  - 内存缓存：`SYMBOL_CACHE` 品种搜索缓存（6h TTL，`histdata/mod.rs:314-335`）；Pine 脚本运行缓存 `RunCache` 上限 512 MB（`backtest/script.rs:80`）；券商账户读取缓存 `brokers::cache`。
  - 数据库缓存：`coingecko_cache` 币表缓存（30m TTL，`portfolios/prices.rs:31,470`）；自选表 `quote` JSONB 内嵌 70 天历史收盘缓存（6h TTL，`watchlists/quotes.rs:32,288`）；下钻低周期缓存表 `histdata_intrabar_cache`（`0141_histdata_intrabar_cache.sql`）；基本面快照表 TTL 6h~30d（`fundamentals/datasets.rs:35-52`）。
- **5 核 11 GB 法国 VPS 资源匹配度**：`deploy/docker-compose.yml` 默认限额：`core` 4 GB（`:176`）+ `postgres` 2 GB（`:247`）+ `caddy` 512 MB（`:67`）+ `dns-proxy` 128 MB（`:198`）≈ **6.6 GB**，日常稳态运行绰绰有余。但**切勿开启可选的 `whisper` 语音容器**（独占 3 GB 限额，`:218`），且在 VPS 上源码编译 `otw-core` + `wasm` 时 Rust 链接峰值吃内存较大（**推测**：建议开启 4 GB swap 防 `cargo build --release` OOM）。

---

## 3. 数据覆盖矩阵

> 评级口径：**真实可用**（开箱即用、无需 key 或免费可用且链路完整）/ **需 key（名称）**（代码已实现，填入免费或付费 key/网关即可用）/ **空壳**（有入口/类型定义但未实现或仅外壳）/ **缺失**（无对应源或链路阻断）。

| 能力维度 | 美股（主力） | 港股 | A股 | 加密（现货） | 加密（永续） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **行情（实时/准实时）** | **真实可用（准实时）** / **需 key（实时 WS）**<br>• Yahoo 免 key 轮询（最低 5s，延迟约 15m 推测）<br>• Alpaca 免费 key IEX 1m WS / 付费 SIP<br>• Massive 付费 WS / IBKR 需本地网关+订阅<br>证据：`yahoo/mod.rs:296-304`、`live/poll.rs:36-38`、`alpaca/mod.rs:39-45`、`massive/mod.rs:21-25`、`ibkr/gateway/contract.rs:8-18` | **真实可用（仅 Yahoo 轮询）** / **需 key（IBKR）**<br>• Yahoo 支持 `0700.HK` 免 key 轮询<br>• IBKR 支持 `700@SEHK:HKD`（需网关+港股行情订阅，推测）<br>• EODHD 需 key（轮询）<br>证据：`yahoo/mod.rs:296-304`、`ibkr/gateway/contract.rs:39-61,143-146`、`eodhd/mod.rs:218-225` | **真实可用（仅 Yahoo 延迟轮询）** / **缺失（直连国内实时源）**<br>• Yahoo 透传 `600519.SS`/`000001.SZ`（延迟且限频风险，推测）<br>• **无新浪/腾讯原生连接器**；Custom HTTP 仅吃 JSON 无法直连 GBK 文本<br>• Watchlist 价格字段写死 `price_usd`（展示原币未折算）<br>证据：`yahoo/mod.rs:296-304`、`histdata/kinds/http.rs:1,728-799`、`watchlists/quotes.rs:266,313-321` | **真实可用**<br>• OKX / Binance / Bybit / Bitget / Gate / Kraken / Coinbase 等均支持**免 key 公开 WS 实时 K 线与 BBO 盘口**<br>• Watchlist/Portfolio 免费接 CoinGecko<br>证据：`histdata/caps.rs:7-29,596-620`、`okx/stream.rs:1-5,102`、`portfolios/prices.rs:188-200` | **真实可用（行情 K 线/盘口）** / **缺失（资金费率/标记价流）**<br>• OKX `BTC-USDT-SWAP` 与 Binance `binance_futures` 均免 key 实时 WS<br>• Watchlist `default_quote_ticker` 缺 `okx` 规则<br>• `DataType::FundingRate` 为空壳枚举<br>证据：`okx/capabilities.toml:12,24`、`histdata/caps.rs:31-55,596-620`、`watchlists/quotes.rs:697-712`、`connectors/model/src/command.rs:19` |
| **K线历史** | **真实可用（日/周）** / **需 key（长周期分钟）**<br>• Yahoo 免 key 支持 `1d`/`1w`（含 `adjclose` 复权）及有限分钟（`1m` 30d、`5m/15m` 60d、`1h` 730d）<br>• Alpaca 免费 key 可拉长历史分钟与日线；EODHD / Massive / Alpha Vantage 需 key<br>证据：`histdata/caps.rs:809-812`、`yahoo/mod.rs:50-60,256`、`alpaca/mod.rs:100-109` | **真实可用（Yahoo）** / **需 key（EODHD / IBKR）**<br>• Yahoo 支持 `.HK` 日线（含 `adjclose`）与短期分钟<br>• EODHD 支持 `0700.HK`（需 key，含 `adjusted_close`）<br>• IBKR 需网关<br>证据：`yahoo/mod.rs:256,296-304`、`eodhd/mod.rs:106-121,218-250`、`ibkr/gateway/contract.rs:143-146` | **真实可用（仅 Yahoo `.SS/.SZ`）** / **需 key（EODHD）** / **缺失（国内免费历史源）**<br>• Yahoo 支持 `600519.SS`/`000001.SZ` 含 `adjclose`（实测法国机房可用性受 Yahoo 限频影响，推测）<br>• EODHD 支持 `.SHG`/`.SHE`（需付费 key，推测）<br>• 东财不通（已知事实），无腾讯/新浪历史适配器<br>证据：`yahoo/mod.rs:256,296-304`、`eodhd/mod.rs:218-250`、`exchanges/calendars.json:393-445`（缺 `XSHE`） | **真实可用**<br>• OKX（300根/页）、Binance（1000根/页）等主流所均免 key 拉 `1m`~`1w` 全历史，UTC 对齐<br>证据：`histdata/caps.rs:7-29,596-620`、`okx/capabilities.toml:12,24` | **真实可用（价格 K 线）** / **缺失（历史资金费率/持仓量）**<br>• OKX SWAP 与 Binance USD-M Futures 均免 key 拉 `1m`~`1w` 价格 K 线（UTC 锚定）<br>• 无历史 funding rate / OI 落库表与拉取器<br>证据：`histdata/caps.rs:31-55,596-620`、`connectors/testkit/src/lib.rs:145` |
| **持仓同步** | **需 key（Alpaca / IBKR / TradeStation）**<br>• IBKR Flex（仅 Token）与 IBKR Gateway、Alpaca、TradeStation 均支持持仓+余额+成交同步<br>• 其他券商（如富途/老虎/嘉信/盈透外）仅能用通用 CSV 导入<br>证据：`brokers/caps.rs:17-44,680-703,831-857`、`journal_import/mod.rs:1-13` | **需 key（仅 IBKR）** / **缺失（富途/老虎/长桥）**<br>• 仅 IBKR Flex / Gateway 支持港股持仓同步<br>• 无港美中文互联网券商 API，只能手动或 CSV 导入<br>证据：`brokers/caps.rs:680-703`、`ibkr/gateway/contract.rs:143-146` | **缺失**<br>• 没有任何 A 股券商 API（亦无同花顺/东方财富/华泰等接口）<br>• 仅能手动录入或走通用 CSV 导入（支持中文表头学习映射）<br>• 组合台账可用 Yahoo `.SS/.SZ` + `journal_fx` 自动转 CNY→USD<br>证据：`brokers/caps.rs:1-1004`、`journal_import/mod.rs:1-8`、`portfolios/prices.rs:8-12`、`journal_fx.rs:21-23` | **需 key（OKX / Binance / Bybit / Bitget / Coinbase 等）**<br>• 余额、挂单、成交（OKX 90天）均真实可用<br>• Portfolio Tracker 同步余额后可用 CoinGecko 估值<br>证据：`brokers/caps.rs:57-79,780-807`、`okx/account.rs:37,183-223` | **半成品（读基础仓位需 key，风控字段与组合估值坏损）**<br>• OKX & Binance USD-M 需 key 可读仓位数量/均价/未实现盈亏<br>• **缺失强平价、标记价（硬编码 `None`）、资金费、保证金率**<br>• OKX 下单仅 E2D 且无止损/TP/SL<br>• 导入 Portfolio Tracker 后空头归零、多头与 USDT 重复估值且无法自动取价<br>证据：`okx/account.rs:249-263,493-518`、`binance/account.rs:228-237,364-376`、`portfolios/ledger.rs:108-126`、`portfolios/prices.rs:319-336` |
| **基本面** | **真实可用（SEC EDGAR / FINRA / Treasury）** + **需 key（FMP / Finnhub / Alpha Vantage / FRED）**<br>• SEC EDGAR 免 key（填姓名+邮箱）查美股财报/公告/Form4 内幕交易<br>• FINRA 免 key 查空头持仓<br>• FMP / Finnhub / AV 需 key 补一致预期/财报日历/同行/ETF<br>证据：`fundamentals/edgar.rs:43-64`、`fundamentals/vendors.rs:392-437`、`fundamentals/datasets.rs:35-52` | **缺失（财报/公司页）** / **需 key（仅分红/ETF）**<br>• Fundamentals 打开公司强制经由 SEC EDGAR 解析 CIK，非美股/非 ADR 直接报错拒绝<br>• EODHD 虽能查 `.HK` 分红/ETF 但公司主页面进不去<br>证据：`fundamentals_api.rs:486-505`、`fundamentals/edgar.rs:256-259`、`fundamentals/vendors.rs:244-304` | **缺失**<br>• `open_company` 强制校验 SEC EDGAR，A 股完全无法开公司页（仅在美上市中概 ADR 如 BABA/PDD 可通过 SEC 20-F 查到部分信息）<br>• 无巨潮/年报/估值 PE/PB 源；Watchlist 的 `pe`/`div_yield` 硬编码 `null`<br>证据：`fundamentals_api.rs:486-505`、`fundamentals/edgar.rs:256-259`、`watchlists/quotes.rs:281-283` | **缺失**<br>• 无链上指标、TVL、解锁、代币经济学等加密基本面连接器（仅有宏观与美股公司）<br>证据：`fundamentals/mod.rs:43-67` | **缺失**<br>• 无资金费率历史、全网 OI、爆仓数据、多空比等永续衍生品基本面<br>证据：`fundamentals/mod.rs:43-67`、`connectors/model/src/command.rs:19` |
| **新闻** | **真实可用（需自配 RSS/API）**<br>• 引擎支持任意 RSS/Atom 与带 Key 的 JSON API 抽取，带 SSE 实时推送、多仪表盘与配额管理<br>• **开箱零预置源**（需自己填 Reuters/Yahoo/SeekingAlpha RSS 或 Finnhub/AlphaVantage News API）<br>证据：`otw-feeds/src/lib.rs:3-6,134-201,261-300`、`migrations/0005_feeds.sql:3-14`、`FeedForm.svelte:86-104` | **真实可用（需自配 RSS/API）**<br>• 同左，可接香港电台/阿思达克/RSSHub 路由或 JSON API，开箱零预置<br>• 无港股个股关联新闻自动聚合<br>证据：`otw-feeds/src/lib.rs:56-62` | **真实可用（需自配 RSS/API）**<br>• 可直接配置财联社/华尔街见闻/金十/RSSHub JSON 或 RSS 源（法国 VPS 需测目标站点可达性，推测）<br>• **无标的代码自动关联新闻**，无个股公告订阅<br>证据：`otw-feeds/src/lib.rs:56-62,261-300`、`feeds_api.rs:29-57` | **真实可用（需自配 RSS/API）**<br>• 可配 CoinDesk / The Block / CryptoPanic API / 吴说 RSS<br>• 开箱零预置源<br>证据：`otw-feeds/src/lib.rs:56-62` | **真实可用（需自配 RSS/API）**<br>• 同现货，可配交易所公告 RSS/JSON API（如 OKX 公告 API，推测）<br>• 无爆仓/异动资金费率快讯联动<br>证据：`otw-feeds/src/lib.rs:56-62` |

---

## 4. 针对三个标的的具体缺口（按影响排序）

### 缺口 1（P0 · 加密永续核心阻塞）：永续合约风险指标全链路缺失（无强平价、资金费、标记价、保证金率）
- **现象**：在实盘账户面板（`BrokerTabs`）查看 OKX 永续仓位时，看不到**强平价（liqPx）**、**标记价（markPx）**、**当前资金费率 / 累计资金费**、**持仓保证金与维持保证金率**，甚至 `leverage` / `margin_mode` 在 OKX 账户读取中也是空的，实盘看仓无法判断爆仓距离与持仓成本。
- **根因**：
  1. 底层标准模型 `otw_connector_model::Position` 未定义强平价、资金费、保证金字段（`core/connectors/model/src/event.rs:224-253`）；
  2. 核心聚合结构 `brokers::Position` 同样缺失这些字段（`core/otw-core/src/brokers/mod.rs:177-214`）；
  3. OKX 解析层 `PositionRow` 根本没有反序列化 `markPx`、`liqPx`、`lever`、`mgnMode`、`imr`、`mmr`、`mgnRatio`、`fundingFee`，并将 `mark_price` 硬编码为 `None`（`core/connectors/providers/src/okx/account.rs:249-263,493-518`，特别是 `:511`）；Binance 合约同样丢弃了 `liquidationPrice` 并将 `mark_price` 置 `None`（`core/connectors/providers/src/binance/account.rs:228-237,364-376`）；
  4. `DataType::FundingRate` 只是模型层空枚举，没有任何 provider 实现（`core/connectors/model/src/command.rs:19`、`core/connectors/testkit/src/lib.rs:145`）；
  5. 前端表格 `BrokerTabs.svelte:402-415` 没有对应列渲染。
- **改法**：在 `otw_connector_model::Position` 与 `brokers::Position` 新增 `liquidation_price`、`margin`、`margin_ratio`、`funding_fee`（可选 `Option<Decimal/f64>`），在 `okx/account.rs`（顺带补全 `binance/account.rs`）反序列化 `markPx`/`liqPx`/`lever`/`mgnMode`/`imr`/`mgnRatio`/`fundingFee`，在 `brokers/native.rs` 透传到 JSON，最后在 `BrokerTabs.svelte` 与 `zh.json` 增补「标记价 / 强平价 / 保证金率 / 资金费」列。
- **预估工作量**：约 **6–8 个文件，6–10 小时**。

### 缺口 2（P0 · 加密永续实盘账目严重失真）：Portfolio Tracker 纯现货做多台账与 OKX 永续合约冲突（含 `21eef76` 隐患）
- **现象**：你的本地提交 `21eef76` 把 OKX 永续持仓并入了券商持仓导入，解决了「合约完全消失」的问题，但引入了**三个严重记账失真**：
  1. **空头合约消失且虚增盈利**：同步一个新开 OKX 空单时，台账写入一条 `sell` 流水，但持仓显示为 `0` 且把整笔卖出名义金额记成已实现盈利，下次同步又重复产生差额；
  2. **多头合约与 USDT 保证金双重计价**：账户实际净值 211 USD（222 USDT 保证金 + 750 USDT 名义价值的 3x 多单），组合总资产会算成 `222 + 750 = 972 USD`；
  3. **永续合约无法自动取价**：`CFX-USDT-SWAP`、`BTC-USDT-SWAP` 导入时必须强行映射到 CoinGecko 或 Yahoo，不能直接用 OKX 现价。
- **根因**：
  1. `core/otw-store/src/portfolios/ledger.rs:108-126,174-189`：`Ledger` 是纯现货多头批次引擎，`take()` 明确注释「卖出超过现有持仓时多余部分直接丢弃」，且 `portfolios.rs:874` 执行 `leg.qty().max(0.0)` 截断负仓位；
  2. `core/otw-core/src/portfolios_import/broker.rs:175,403,419-427`：遇到 `side == "short"` 时转成负数 `broker_qty`，在 `held == 0` 时生成 `side = "sell"` 流水，直接撞上 `ledger.rs` 的现货做多假设；
  3. `core/otw-store/src/portfolios.rs:889,927`：`net_worth = market_value + cash_total`，把全额合约名义价值叠加在保证金余额上；
  4. `core/otw-core/src/portfolios/prices.rs:319-336` 与 `core/otw-core/src/portfolios_import/mod.rs:41`：定价源白名单写死为 `coingecko` / `yahoo`（及覆盖表里仅有 `binance`/`kraken`/`coinbase`），没有 `okx`。
- **改法**：两条路线二选一（推荐路线 A，改动小且不破坏税务/净值口径）：
  - **路线 A（推荐，最省事）**：合约仓位不塞进现货批次台账，而是将「账户实盘持仓视图（OKX/IBKR 衍生品仓位 + 净权益）」做成独立的 **Broker Live Positions 面板/Dashboard Widget** 直接展示交易所真实 Equity、保证金、多空仓位、未实现盈亏与强平价；Portfolio Tracker 专注现货/股票长期资产，同步 OKX 时只记净权益（`account_summary.equity`）或把合约标为 `derivative` 仅计未实现盈亏而非全额名义价值。
  - **路线 B（重改台账）**：改造 `ledger.rs` 支持有符号仓位与 `derivative` 保证金模式 + 在 `prices.rs` 与 `portfolios_import/mod.rs` 加入 `okx` 报价源。
- **预估工作量**：路线 A 约 **4–5 个文件，6–8 小时**；路线 B 约 **8–10 个文件，18–24 小时**。

### 缺口 3（P0 · A股核心阻塞）：A股无原生低成本实时/日K数据源、缺深交所交易日历
- **现象**：看 A 股只能把 `.SS`/`.SZ` 勉强挂在 Yahoo 上（法国机房存在 15 分钟延迟、偶尔 429 限频、无盘口/中文名，且 Yahoo 缺失部分次新/北交所/ETF 复权细节，**推测**）；已知东财 `push2his` 从你的服务器不通；想用 OTW 自带的 Custom HTTP 源直连可用的新浪 `hq.sinajs.cn` / 腾讯 `qt.gtimg.cn`，却发现 Custom HTTP 只认 JSON；另外 `exchanges/calendars.json` 缺少深交所 `XSHE`，且上交所 `XSHG` 节假日仅维护到 `2026-12-31`。
- **根因**：
  1. `core/connectors/providers/src/lib.rs` 中零中国股票 provider；
  2. `core/otw-core/src/histdata/kinds/http.rs:1,728-799` 硬编码只解析 `serde_json::Value`，无法解码 GBK 编码的新浪 `var hq_str_sh600519="...";` 或腾讯 `v_sh600519="...";` 文本；
  3. `core/otw-core/src/exchanges/calendars.json:393-445` 仅有 `XSHG`（`covered_to: "2026-12-31"`），无 `XSHE`（`calendars.json` 检索 0 命中）；
  4. `core/otw-core/src/watchlists/quotes.rs:266,313-321` 自选表通过 Yahoo 或自定义 Connector 拉取 CNY 标的时，把原币价格原样写进 JSON 键 `price_usd`（虽然保留了 `currency` 字段，但聚合/提醒口径易混淆）；
  5. `core/otw-core/src/portfolios/prices.rs:319-336` 无法调用自定义 HTTP Connector 为 A 股组合估值（只能走 Yahoo）。
- **改法**：见文末 **专题问答 A**（推荐「轻量 Sidecar 翻译腾讯/新浪为 JSON 喂给 Custom HTTP/Push」或「新增原生 `cn_equity` Connector」+ 补 `XSHE` 日历与 2027 节假日）。
- **预估工作量**：Sidecar 零改 Rust 方案 **1 个 sidecar 脚本 + docker-compose 片段，3–4 小时**；原生 Rust 全面接通（行情+历史+组合+自选+日历）约 **7–9 个文件，12–16 小时**。

### 缺口 4（P1 · 回测引擎跨市场组合失真）：多标的混跑无币种折算、全局共享单套 `Instrument` 参数、无 A股交易制度约束
- **现象**：如果你想在一个组合回测里同时喂入美股日线（USD）+ A股日线（CNY）+ 加密日线（USDT），可以跑通（只要同为 `1d`），但结果会**静默算错**：1 股茅台 1500 CNY 和 1 股英伟达 130 USD 直接按 1:1 现金池混合计算净值与仓位；A股允许 T+0 买入当日止损卖出、没有 ±10%/±20% 涨跌停封板拦截；且所有标的被迫共用同一个 `lot_step`、`multiplier` 和 `funding` 年化费率（给加密开的 10.95% 年化资金费也会扣在美股和 A股头寸上！）。
- **根因**：
  1. `core/otw-core/src/backtest/mod.rs:1374-1394,2925-2933,3503,4373-4382`：`Settings` 中 `instrument`（`multiplier`/`lot_step`/`min_qty`/`tick_size`）、`fees`、`funding` 均为**全局单一配置**，遍历 `for a in &assets` 对所有持仓统一扣资金费和乘 `mult`，完全无币种字段与汇率表；
  2. `core/otw-core/src/backtest_api.rs:310-319,628-637` 强制同一次运行的所有数据集必须同一周期（不能美股 `1d` 配加密 `1h`）；
  3. `core/otw-core/src/align.rs:106,124-139` 日线按 UTC `YYYY-MM-DD` 合并（美股美东收盘转 UTC 时间戳与 A股北京时间收盘、加密 00:00 UTC 日线存在跨日/周末空 bar 错位）；
  4. `core/otw-core/src/backtest/mod.rs:3834-3994,4386-4399` 没有 T+1 锁定、没有涨跌停成交拒单、也没有高杠杆永续的强制平仓（破产清算）逻辑（`equity` 可一路跌穿 0 变为负数而不爆仓，`margin_free` 检查只在开新仓/加仓时触发，`mod.rs:5694-5720`）。
- **改法**：日常研究优先**分市场单跑回测**（美股跑 USD、A股设 `lot_step=100` 跑 CNY、加密单独开 `funding` 跑 USDT）；中长期在 `Settings` 增加 `per_asset_overrides`（按 ticker 覆盖 `multiplier`/`lot_step`/`funding`/`t_plus_1`）及强平线检查 `equity <= maintenance_margin`。
- **预估工作量**：仅补永续强平保护 + A股 T+1 开关约 **2–3 个文件，6–8 小时**；补齐多币种 FX 组合回测与分标的覆盖约 **5–7 个文件，16–24 小时**。

### 缺口 5（P1 · 美股实盘/研究轻度缺口）：美股实时行情成本权衡 + 组合/基本面与中概/非美隔离
- **现象**：美股日线和 SEC 基本面免费就很强，但想在图表看**实时盘中 K 线**时，Yahoo 只有轮询延迟，Alpaca 免费版只有 IEX（约占美股成交量 2–3%，价差和极值偏离全市场 SIP，**推测**）；另外如果你想在同一个 Fundamentals 页面查 A股/港股基本面，点击直接报 `SEC EDGAR has no company`。
- **根因**：
  1. `core/connectors/providers/src/alpaca/mod.rs:39-45` 与 `core/otw-core/src/options/alpaca.rs:45-46`：免费档绑定 IEX 与 15 分钟延迟 indicative 期权；
  2. `core/otw-core/src/fundamentals_api.rs:486-505`：`open_company` 硬依赖 `edgar::resolve`，没有 fallback 到 EODHD/FMP 非美股票档案的路径。
- **改法**：
  - 美股方案：**零额外花钱组合**＝`Yahoo`（复权日线）+ `Alpaca 免费 Key`（美股历史分钟 K 线 + 免费 IEX 实时流 + 期权链参考）+ `SEC EDGAR`（免 key 财报/Form4）+ `FINRA`（免 key 空头）+ `Finnhub 免费 Key`（财报日历/评级/同行）。如果你有 **IBKR 实盘账户**，接上 IBKR Flex（持仓/日志）或 IB Gateway（行情/持仓），无需买任何昂贵行情订阅（**推测**：IBKR 基础美股实时包约 $4.5–$10/月远低于 Polygon/Massive 或 FMP 付费档）。
  - 若未来需要港股/A股公司页：解除 `open_company` 对 EDGAR 的强耦合（允许非美 ticker 直接由 EODHD/自定义源建档）。
- **预估工作量**：美股零代码纯配置 **0 文件，1 小时**；解除 Fundamentals 的 EDGAR 强绑定约 **4–5 个文件，8–12 小时**。

### 缺口 6（P2 · 加密实盘执行与自选体验）：OKX 下单能力停留在 E2D 纸面级、Watchlists 缺 OKX 默认规则
- **现象**：① 在图表/交易面板向 OKX 下单时，代码明确标定为 **E2D（仅按文档编写，未在真实/模拟盘实测）**，且不支持止损单、止盈止损附带单（TP/SL）、追踪止损、OCO、杠杆调节；② 在 Watchlists 里绑定 OKX 连接器看币价时，`default_quote_ticker` 没写 `"okx"` 映射规则，输入 `BTC` 不会自动拼 `BTC-USDT` 或 `BTC-USDT-SWAP`，每次需手填 `quote_ticker`。
- **根因**：
  1. `core/connectors/providers/src/okx/PROVIDER.md:120-121,173-175,314-321` 与 `okx/capabilities_swap.toml:4-14`；
  2. `core/otw-core/src/brokers/live.rs:74-112`（E2D 实盘需手工二次确认+三条风控硬上限）；
  3. `core/otw-core/src/watchlists/quotes.rs:697-712`（只写了 `binance`/`coinbase`/`kraken`/`alpaca`/`massive`/`yahoo`/`eodhd`）。
- **改法**：OKX 保持**只读 API Key** 看仓位和同步交易日志，不在 OTW 里对 OKX 实盘下单（或仅做 Demo 验证后补齐 `orders-algo` 条件单）；Watchlists 顺手补 2 行 `"okx"` 默认 ticker 规则。
- **预估工作量**：Watchlists 补 OKX 映射 **1 个文件，0.5 小时**；把 OKX 条件单/TP-SL 做到 E4 实测级约 **5–6 个文件，20–30 小时**（单人自用性价比低）。

### 缺口 7（P2 · 新闻抓取开箱无预置源、无标的自动联动）
- **现象**：News 模块本身引擎完整（RSS + JSON API + SSE + 配额），但装好后**一条新闻也没有**，必须全手工配置 RSS/API 与 JSON Path；且新闻流与 Watchlists / HistViz 图表之间没有按 ticker 自动过滤关联。
- **根因**：`core/otw-store/migrations/0005_feeds.sql` 与 `0030_feed_dashboards.sql` 只建空表和空默认看板，未预置任何 feed；`core/otw-feeds/src/lib.rs:174-200` 只存通用 `title`/`summary`/`url`，不做 ticker 提取。
- **改法**：整理一份覆盖美股（SEC/Yahoo/CNBC/Finnhub News API）、A股（财联社电报/华尔街见闻 JSON API 或自建 RSSHub）、加密（CoinDesk/OKX 公告/吴说）的 JSON/RSS 配置导入；可选在 `feed_items` 查询加关键词/标的快速筛选标签。
- **预估工作量**：配置清单导入 **0 代码，1–2 小时**；加标的关联筛选约 **3–4 个文件，4–6 小时**。

---

## 5. 空壳或半成品模块清单

> 区分三类：**真代码空壳**（Stub/纯外嵌）、**对你的场景呈半成品**（核心功能缺关键拼图）、**完整但偏题/低 ROI**（在 §7 中说明）。

| 类别 | 模块 / Crate 名 | 现状与缺什么（含证据） | 是否值得补？ |
| :--- | :--- | :--- | :--- |
| **真代码空壳** | `core/otw-{modules,queue,runner,i18n,theme}`（5 个 Rust crate） | 全部只有 9 行 Phase 0 占位代码，实际逻辑都在 `otw-core` 单体里（`core/otw-*/src/lib.rs:1-9`） | **否**。别去重构拆包，保持上游结构避免后续冲突 |
| **真代码空壳（类型级）** | `DataType::FundingRate`（连接器框架） | 在 `core/connectors/model/src/command.rs:19` 定义了变体，但**零个 provider 实现**（`core/connectors/testkit/src/lib.rs:145`） | **值得补（P1）**。补给 OKX/Binance 永续用于看资金费历史与回测 |
| **纯第三方外嵌外壳** | **Economics（财经日历）** | 整个前端模块只有 1 个 82 行文件 `frontend/src/lib/modules/economics/EconomicCalendar.svelte:1-82`，纯塞一个 TradingView iframe 脚本，且 `locale: 'en'` 硬编码英文（`:26`），无后端存储与提醒联动 | **不值得大改**。只改 `locale: 'zh_CN'`（1 行，**推测**支持）或直接关掉改用 Fundamentals 里的市场日历 |
| **半成品（对你）** | **OKX 交易执行（E2D）** | 只支持 `market`/`limit` 与改撤单，缺止损/止盈附带单/追踪止损/杠杆设置/反向合约，且未经过真实账户测试（`okx/PROVIDER.md:120-121,173-175,314-321`、`okx/capabilities_swap.toml:4-14`） | **暂不值得补**。实盘下单留在 OKX App/网页，OTW 只读看仓+记日志更安全 |
| **半成品（对你）** | **永续仓位展示（BrokerTabs + Position 模型）** | 缺强平价、标记价（被写死 `None`）、资金费率/累计资金费、保证金与保证金率（`okx/account.rs:493-518`、`brokers/mod.rs:177-214`、`BrokerTabs.svelte:402-415`） | **极值得补（P0）**。改动小、对你 OKX 永续主战场景提升立竿见影 |
| **半成品（对你）** | **Portfolio Tracker 对合约与 A股支持** | 台账纯现货做多（空头变 0 且虚报盈利，`portfolios/ledger.rs:108-126`）；估值叠加名义价值+现金（`portfolios.rs:927`）；定价白名单无 OKX 和自定义源（`portfolios/prices.rs:319-336`） | **极值得补（P0）**。拆清「现货/股票台账」与「合约实时净值/持仓面板」 |
| **半成品（对你）** | **Custom HTTP 数据源** | 功能架构很棒（支持 `daily_tz`、轮询、内网地址），但解析层锁死 JSON，不支持非 JSON 文本/GBK 编码，且不能给 Portfolio 定价（`histdata/kinds/http.rs:1,728-799`） | **值得通过 Sidecar 绕开（P0）**，无需硬改 `http.rs` 解析器 |
| **半成品（对你）** | **Fundamentals（公司页）** | 美股很完整（EDGAR + FINRA + FMP/Finnhub），但建档强制过 SEC EDGAR CIK，港股/A股/加密完全进不去（`fundamentals_api.rs:486-505`、`edgar.rs:256-259`） | **P2 视需求补**。美股够用；A股基本面靠外部软件/AI 更省心 |
| **半成品（开箱体验）** | **News（新闻流）** | 引擎扎实但零预置源、无个股 ticker 关联（`otw-feeds/src/lib.rs:56-62`、`migrations/0005_feeds.sql`） | **值得配源（P0/P1）**。配好 10–15 个中英 RSS/JSON 源即可成主力 |
| **脆弱抓取模块** | **Managers' Portfolios（大佬持仓）** | 靠手写字符串解析爬取 Dataroma HTML 表格（`core/otw-core/src/mportfolios/mod.rs:1-20,107-160`），仅覆盖美股 13F 季报（滞后 45 天），网页改版即失效 | **不值得投入维护**。当附赠玩具看即可，坏了直接关模块 |
| **地区强绑定半成品** | **Tax Calculator（税务计算）** | 内置 13 份税制 TOML（法/德/英/美/瑞/西/意/澳，`core/otw-core/src/taxcalc/regime.rs:23-37`），无中国大陆/香港规则（若你是法国税务居民则 `fr_pfu/2026.toml` 反倒真有用！） | **按你的税务居民地决定**：非上述国家直接关模块；若是法国税务居民可留着参考 `fr_pfu` |

---

## 6. 改造路线图（P0 / P1 / P2）

### P0：不修就没法真正用起来（建议第 1–2 周完成）

| 编号 | 改造项 | 核心动作 | 可验收完成标准 |
| :--- | :--- | :--- | :--- |
| **P0-1** | **补齐 OKX 永续仓位风控字段** | 在 `otw_connector_model::Position`、`brokers::Position`、`okx/account.rs`（顺手补 `binance/account.rs`）、`brokers/native.rs` 与 `BrokerTabs.svelte` 补齐 `mark_price`、`liquidation_price`、`leverage`、`margin_mode`、`margin`、`margin_ratio`、`funding_fee` 并汉化表头 | 打开 HistViz 下方 OKX 实盘仓位表，任意多/空永续仓位同时正确显示：标记价、强平价、杠杆倍数、全/逐仓、保证金率、累计资金费，数值与 OKX App 误差 < 0.1% |
| **P0-2** | **修复 OKX 永续与 Portfolio Tracker 账目冲突** | 方案二选一（推荐：① 在 `portfolios_import/broker.rs` 将永续持仓从现货批次导入中隔离，改为同步账户真实 Equity/净值或独立「实盘合约面板」Widget；或 ② 改造 `ledger.rs` 支持空头/保证金模式 + `prices.rs` 接 OKX 现价） | ① 同步含空头合约的 OKX 账户后，不会产生虚增已实现盈利、连续两次同步 delta 归零；② 含 3x 杠杆多单的 211 USD OKX 账户，组合净值展示接近 211 USD 而非 972 USD |
| **P0-3** | **打通 A 股低成本行情与日K（绕开东财）** | 在同机 Docker Compose 增加轻量 Python/FastAPI（或 Go）**A股 JSON 适配 Sidecar**（约 150 行），后端拉腾讯 `qt.gtimg.cn` + 新浪 `hq.sinajs.cn` 提供准实时报价，拉腾讯 `web.ifzq.gtimg.cn` 前复权日K（**推测**法国 VPS 可达，部署首日 `curl` 实测；若不通则自动回退 Yahoo `.SS/.SZ` `adjclose` 日K），暴露标准 JSON 给 OTW 的 Custom HTTP Connector（开启 `allow_private_hosts`、`daily_tz=Asia/Shanghai`、`poll_secs=10`） | ① 在 HistData 中成功下载 `sh600519`、`sz000001`、`sh510300` 近 5 年日线且无缺口、无乱码；② HistViz 盘中每 10s 自动跳动更新当前日K/分时价；③ 回测引擎可直接加载该数据集跑完双均线策略 |
| **P0-4** | **补齐深交所 `XSHE` 日历并更新 2027 节假日** | 编辑 `core/otw-core/src/exchanges/calendars.json` 增加 `XSHE`（深交所，09:30–11:30 / 13:00–15:00 `Asia/Shanghai`），并更新 `XSHG`/`XSHE` 节假日表 | 交易时段过滤、开休市状态与回测 Session Filter 对上证/深证标的均正常识别午休与法定节假日 |
| **P0-5** | **落地三市场基础配置（美股免费组合 + 新闻源包）** | ① 配置 Yahoo + Alpaca 免费 Key + SEC EDGAR + FINRA + Finnhub 免费 Key；② 配置 OKX 只读 Key（禁下单/禁提币）用于持仓与交易日志同步；③ 在 News 模块导入 10–15 条美股/A股/加密 RSS 或 JSON API 源并分 3 个看板；④ 在设置中隐藏不用的冗余模块（见 §7） | ① 美股/A股/OKX永续均可打开图表看 K 线；② OKX 近 90 天成交自动同步入 Trading Journal；③ News 看板每 5–15 分钟稳定拉取三市场快讯，无报错红点 |

### P1：明显提升日常使用效率（第 3–4 周完成）

| 编号 | 改造项 | 核心动作 | 可验收完成标准 |
| :--- | :--- | :--- | :--- |
| **P1-1** | **Portfolio Tracker & Watchlists 打通自定义源与 OKX 定价** | 在 `portfolios/prices.rs` 与 `portfolios_import/mod.rs` 新增 `okx` 与自定义 HTTP 价格源支持；在 `watchlists/quotes.rs:697-712` 补 `"okx"` 默认 ticker 映射，并明确自选表非 USD 标的的货币符号展示（不再混淆 `price_usd`） | ① A股组合持仓可通过本地 A股 Sidecar 取价（不依赖 Yahoo），CNY 经 `journal_fx` 自动折算；② Watchlists 绑 OKX 连接器添加 `BTC` 自动识别 `BTC-USDT`/`BTC-USDT-SWAP` 并正常显示价格与涨跌幅 |
| **P1-2** | **升级 A 股通道为原生 Rust Connector（可选替代 Sidecar）** | 若 Sidecar 跑通后希望单容器更干净，在 `core/connectors/providers/src/` 新增 `cn_equity` provider（原生处理 GBK 转码与腾讯/新浪协议）并接入 `histdata/native.rs`、`histdata/caps.rs`、`symbolFormats.js` | 移除 Sidecar 容器后，A股搜索、日K下载、盘中轮询、自选与组合估值全部在 `otw-core` 内原生闭环 |
| **P1-3** | **回测引擎补强：永续强平保护 + A股 T+1 开关 + 历史资金费率** | ① `backtest/mod.rs` 增加 `maintenance_margin_pct` 强平逻辑（净值触线强制平仓并记 `"liquidation"`）；② 增加 `t_plus_1: bool` 禁止买入当交易日卖出；③ 实现 OKX/Binance 的 `DataType::FundingRate` 历史拉取并接入回测资金费扣减 | ① 10x 杠杆逆势扛单 12% 触发强制平仓而非净值变负继续扛；② A股日线回测开启 T+1 后不会出现同日开平；③ 加密永续回测可加载真实历史 8h 资金费率序列 |
| **P1-4** | **统一美股实盘持仓同步（视你所用美股券商）** | 若用 IBKR/Alpaca/TradeStation，直接配只读/Flex 同步；若用富途/老虎/长桥/华盛等未内置券商，先用 `journal_import` / `portfolios_import` 的通用 CSV 映射保存一套中文模板（一次配置、后续拖文件即同步） | 美股成交与持仓 2 分钟内完成周度/日度对账，Trading Journal 统计曲线（胜率/盈亏比/净值）涵盖美股 + OKX 双市场 |

### P2：锦上添花（按需推进）

| 编号 | 改造项 | 核心动作 | 可验收完成标准 |
| :--- | :--- | :--- | :--- |
| **P2-1** | **回测分标的覆盖配置 & 多币种 FX 换算** | 支持在多标的回测里按 ticker 指定独立 `lot_step`/`multiplier`/`funding` 与计价币种，自动读取 `journal_fx` 历史汇率折算到账户主币种 | 美股（USD）+ A股（CNY）+ 加密（USDT）混跑单一组合回测时，单笔盈亏与资金费扣减均符合各自市场规则与汇率 |
| **P2-2** | **新闻按自选标的高亮与一键筛选** | 在 `feed_items` 列表支持按当前 Watchlist 标的/中文别名自动打标签筛选 | 点击自选股 `NVDA` 或 `600519` 可一键过滤近 7 天相关快讯 |
| **P2-3** | **建立本地 Fork 升级流水线（防汉化与补丁被覆盖）** | 将你的 13 个本地改动文件收拢为独立的 Git patch 分支策略 + 禁用 `otw update` 改用受控源码构建脚本 | 上游发布 `v0.1.7+` 时，30 分钟内完成 rebase、重新构建镜像并保留全部汉化与自定义功能 |

---

## 7. 不建议做的部分（功能过剩 / 维护成本高于收益）

本仓库共 34 个前端模块，属于「全能个人金融操作系统」，对你的核心诉求（看持仓、看行情、跑回测、记交易、抓新闻）而言，**强烈建议直接在模块管理里关闭、不要花时间二次开发或补汉化**的部分如下：

| 模块 / 功能 | 源码位置 | 为什么不建议投入 |
| :--- | :--- | :--- |
| **Trading Robots（实盘自动交易机器人）** | `core/otw-core/src/robots/mod.rs:1-29` | 每次 tick 全量重放回测引擎 diff 状态发单；加上 OKX 仅 E2D 且缺条件单/止损保护，拿它接实盘资金风险极高、调试成本远大于收益；回测研究足矣，实盘自动化建议用成熟独立脚本 |
| **OKX 实盘下单补全到 E4 级** | `core/connectors/providers/src/okx/PROVIDER.md:120-121,314-321` | 需自建条件单/TP-SL/仓位模式/杠杆/异常对账全套实测，工作量 20–30h+ 且稍有疏漏就是真金白银损失；OKX 保持**只读 API Key** 最安全 |
| **Options（美股期权链分析）** | `core/otw-core/src/options/mod.rs:1-22`、`options/alpaca.rs:1-10` | 免费 Alpaca 源延迟 15 分钟且报价失真，要实时 OPRA 需昂贵订阅；除非你是专职美股期权卖方，否则直接关 |
| **Whisper 语音控制 & 语音容器** | `core/otw-core/src/voice_api.rs:1-7`、`deploy/docker-compose.yml:218` | 单独吃 3 GB 内存，对单人桌面交易工作台属于噱头功能，在 11 GB VPS 上浪费宝贵内存 |
| **Chat 外部控制（Telegram/Discord/Slack 驱动 Agent）** | `core/otw-core/src/control/mod.rs:1-24` | 需维护长轮询 Bot + MCP 权限审计，与核心交易看板无关 |
| **个人效率杂项套件**（Mailbox、Time Tracker、Mindset、Routines、Todos、Calendar、Subscriptions、Goals、Wealth、Prompt Store、Resources） | `frontend/src/lib/modules/registry.js:14-268`、`mailbox_api.rs:1-6` | 虽非空壳，但把交易台拖成臃肿的 Notion/记账本；**直接停用**可显著降低侧边栏噪音和后续汉化维护负担 |
| **Economics（TradingView iframe） & Managers' Portfolios（Dataroma 爬虫）** | `EconomicCalendar.svelte:21-31`、`mportfolios/mod.rs:1-20` | 一个是硬编码英文外嵌页，一个是易碎 HTML 爬虫；前者用新闻/财报日历替代，后者直接关 |
| **Community Docs 远程同步** | `core/otw-core/src/community_docs_api.rs:30,39` | 拉取上游英文社区文档，对已汉化的个人交易台价值低，且存在外部站点依赖 |
| **把 5 个 Phase-0 Stub Crate 拆实** | `core/otw-{modules,queue,runner,i18n,theme}/src/lib.rs:1-9` | 纯内部架构演进遗留，拆包无任何业务收益且必然导致每次上游升级大面积冲突 |
| **为 A 股 / 港股接入全套商业基本面源（如重购昂贵万得/FMP Ultimate/Polygon 全家桶）** | `fundamentals/fmp.rs:24-26`、`fundamentals_api.rs:486-505` | 违背你不愿多市场重复买昂贵 API Key 的原则；美股靠免费 EDGAR + FINRA + Finnhub 免费档已够 80% 需求，A股基本面直接用免费外部网站（如理杏仁/巨潮/雪球）配合 OTW 记笔记即可 |

---

## 8. 风险评估（数据、汉化、部署）

| 风险维度 | 风险等级 | 具体隐患与源码证据 | 规避措施 |
| :--- | :---: | :--- | :--- |
| **1. 上游升级直接抹平本地汉化与 `21eef76` 补丁** | **极高** | 上游采用 **Fresh Snapshot 发布模式**（每个 release 是独立历史快照，`git pull` 会直接报 divergent branches 失败），官方文档明确要求源码构建用户执行 `git reset --hard origin/master`（`docs/guide/updating.md:75-89`、`README.md:334`）；而 `otw update` 脚本会直接覆盖 `deploy/` 并从 Docker Hub 拉取官方预构建镜像（`deploy/otw:265-302`、`deploy/docker-compose.images.yml:12-26`）——**一旦执行官方升级，你的 13 个本地修改文件（含 457 行 `labels.zh.json`、393 行 `zh.json` 补丁及 `21eef76`）将瞬间失效** | ① 严禁在自编译分支上运行 `otw update` 或裸跑 `git reset --hard`；② 用 `git format-patch 88f1944..HEAD` 归档本地补丁，或把本地改动控制在独立目录（如 `i18n`、新增 sidecar）并维护单一 `custom` 分支；③ 升级前先在临时分支 `git cherry-pick` / `git apply` 演练 |
| **2. 数据库 Schema 自动迁移不可逆** | **高** | `otw-core` 启动自动执行 `sqlx::migrate!("./migrations")`（`core/otw-store/src/lib.rs:114`），无自动回滚；且夜间轻备份 `otw backup` 默认跳过 `findb_instruments` 和 `histdata_bars` 两张大表（`deploy/otw:30,147-152`） | 任何升级或新增自建表前，必须先跑 `OTW_FULL=1` 全量 `pg_dump` 备份；**尽量不要擅自修改上游已有 migration 文件或表结构**（如加字段优先放 JSONB 或独立 `cn_*` 迁移号且注意与上游递增序号冲突风险） |
| **3. 本地 `21eef76` 导致的实盘组合脏数据** | **高** | 如缺口 2 所述，已同步进 Portfolio Tracker 的 OKX 永续仓位（尤其是空头）会产生错误的 `sell` 流水、虚假已实现盈利与夸大的总净值（`portfolios_import/broker.rs:403-427`、`portfolios/ledger.rs:108-126`、`portfolios.rs:927`） | 执行 P0-2 前，先把已误导入的 OKX 合约同步批次在 Portfolio Import 历史里整批回滚（系统支持按 `batch_id` 撤销，`portfolios_import/broker.rs:382-390`） |
| **4. 法国 VPS 源码编译与构建内存峰值** | **中** | 只要你改了 Rust 或前端汉化，就必须走源码构建（`core/Dockerfile:10-15` 编译 `otw-core`，`frontend/Dockerfile:12-32` 同时编译 `wasm32` + Node 26 Vite 构建），在 5 核 11 GB VPS 上同时跑 PostgreSQL + Docker BuildKit 容易触发瞬时内存吃紧（**推测**） | ① 给 VPS 配 4 GB swap；② 只改前端汉化时仅重建 `frontend` 服务（`docker compose up -d --build frontend`），避免重编 Rust；③ 新增 A股采集优先用独立 Sidecar 容器，减少重编 `otw-core` 频率 |
| **5. API Key 泄露与误下单风险** | **中** | OKX 在 OTW 中处于 E2D 未实测等级（`okx/PROVIDER.md:120-121`），部分券商（如 OANDA/Capital.com）甚至没有只读 Key（`brokers/caps.rs:735-739`） | OKX API Key **严格只勾 Read 权限 + 绑定法国 VPS 固定 IP 白名单**，绝对不勾 Trade 与 Withdraw；美股 IBKR 优先用只读的 Flex Web Service Token（`brokers/caps.rs:687-690`） |
| **6. 新增免费数据源的稳定性与反爬限频** | **中** | Yahoo 非官方 chart 接口偶发 429/结构微调；新浪 `hq.sinajs.cn` 要求必须带 `Referer: https://finance.sina.com.cn` 请求头否则返回 403（**推测**）；腾讯日K接口存在单次条数与复权字段边界（**推测**） | Sidecar 或原生 Connector 内置请求节流、主备源切换（腾讯主 + 新浪备 + Yahoo 复权兜底）与失败告警，不让单源故障拖垮主服务 |

---

## 专题问答 A：A 股怎么接最省事？

### A.1 现有代码里有没有任何 A 股 / 中概数据路径？

**有 4 条隐藏的“半路径”，但没有任何原生国内股票连接器**：
1. **Yahoo Finance 连接器（已可用，免 Key）**：`core/connectors/providers/src/yahoo/mod.rs:296-304` 允许代码含 `.` 并原样拼入 `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`，支持复权收盘 `adjclose`（`:256`）与分钟线（`1m` 30天、`5m/15m` 60天、`1h` 730天，`:50-60`）。因此输入 **`600519.SS`（上交所）**、**`000001.SZ`（深交所）**、**`0700.HK`（港股）** 已经可以直接下载日K、看轮询准实时图表、加入 Watchlists 与 Portfolio Tracker（且 `portfolios/prices.rs:8-12,218-274` 会自动用 `journal_fx` 把 `CNY` 转成 `USD`！）。
2. **中概美股 ADR（已完全可用）**：在美上市中概（`BABA`/`PDD`/`JD`/`BIDU`/`KWEB` 等）属于标准美股，直接走 Alpaca + Yahoo + SEC EDGAR（20-F）全链路可用（`fundamentals/edgar.rs:256-259`）。
3. **EODHD & IBKR（需 Key / 网关）**：`eodhd/mod.rs:218-250` 原样透传 `CODE.EXCHANGE`（可接 `600519.SHG` / `000001.SHE`，需付费 Key，**推测**）；`ibkr/gateway/contract.rs:143-146` 支持 `SYMBOL@EXCHANGE:CURRENCY`（沪股通/深股通，需 IB 网关与行情订阅，**推测**）。
4. **基础货币与部分交易日历已就位**：`core/otw-store/src/journal_fx.rs:21-23` 已内置 `"CNY"` 与 `"HKD"` 免费日汇率；`core/otw-core/src/exchanges/calendars.json:393-445` 已内置上交所 `XSHG`（但缺深交所 `XSHE`）。

**不存在的路径**：全仓搜索 `sina`、`gtimg`、`eastmoney`、`tushare`、`akshare` 均为 **0 命中**；A 股券商 API 为 0；基本面公司页因强绑定 SEC EDGAR 无法开 A 股公司。

### A.2 最小可行做法（新浪/腾讯可用 + 东财日K不可用）

你服务器的已知事实是：**东财 `push2his` 不通，新浪 `hq.sinajs.cn` 与腾讯 `qt.gtimg.cn` 可用**。据此提供两套按省事程度排序的落地方案：

#### 方案 1（最省事 · 推荐先跑通，零改 Rust 核心代码）：轻量 Sidecar JSON 适配器 + OTW 内置 Custom HTTP 源

**核心思路**：OTW 已经为你写好了一整套配置驱动的 `Custom HTTP` 连接器（`core/otw-core/src/histdata/kinds/http.rs`），支持 `daily_tz: "Asia/Shanghai"`、支持盘中 `poll_secs` 自动轮询推送到图表（`:222`）、支持访问 Docker 内网服务 `allow_private_hosts: true`（`:274`）——它唯一的限制是**只吃 JSON**（`:1,728-799`）。因此只需在 `deploy/docker-compose.yml` 旁边挂一个 ~150 行 Python（FastAPI/aiohttp）小容器（内存 < 40 MB），把腾讯/新浪协议翻译成标准 JSON 数组即可：
- **实时报价 / 当日 K 线**：主调腾讯 `https://qt.gtimg.cn/q=sh600519`（GBK 解码，字段含今开/最高/最低/现价/成交量/昨收），备调新浪 `https://hq.sinajs.cn/list=sh600519`（必须带 `Referer: https://finance.sina.com.cn`，**推测**）。
- **历史日 K 线（绕开东财）**：
  - 首选 **腾讯复权日 K 接口** `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,2020-01-01,2026-12-31,640,qfq`（与 `qt.gtimg.cn` 同属腾讯财经体系，**推测**从法国 VPS 同等可达，支持前复权 `qfq`、每次返回最多 640 根、按时间窗翻页即可拉 10 年历史）；
  - 备选 **新浪历史 K 线** `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData`（支持 5m/15m/30m/60m/日线，**推测**从法国 VPS 需实测可达性且无直接复权）；
  - 兜底 **Yahoo `.SS/.SZ`**（直接复用已有 Yahoo 复权日K，盘中由腾讯/新浪拼出今日最新一根 K 线）。
- **要改的文件（极少，且不碰上游 Rust 源码，升级零冲突！）**：
  1. 新增 `sidecar/cn-quote/app.py` + `sidecar/cn-quote/Dockerfile`（独立目录，实现 `/bars?ticker=&tf=&from=&to=` 与 `/quote?ticker=` 返回标准 JSON）；
  2. 新增 `deploy/docker-compose.cn.yml`（独立 override 文件，启动时 `-f docker-compose.yml -f docker-compose.cn.yml`，完全不改上游 `docker-compose.yml`）；
  3. 仅 1 处可选小改源码：`core/otw-core/src/exchanges/calendars.json` 补入 `XSHE` 深交所日历（约 50 行 JSON）。
- **不足**：Portfolio Tracker 的 `prices.rs` 默认还不能直接调 Custom HTTP 源给 A 股持仓估值（仍需暂用 Yahoo `.SS/.SZ` 估值，或再改 2 个 Rust 文件把 Custom HTTP/Sidecar 接入 `prices.rs`）。

#### 方案 2（一步到位 · 原生 Rust Provider，彻底接入全栈）

如果你不想要额外 Sidecar 容器，并希望 A 股同时打通「历史 K 线 + 盘中图表 + Watchlists + Portfolio Tracker 估值」，需要修改以下 **8 个文件**：

| 序号 | 文件路径 | 改动内容 |
| :---: | :--- | :--- |
| 1 | `core/connectors/providers/src/cn_equity/mod.rs`（新增） | 实现 `Mapper`：编码转换（`encoding_rs` 解 GBK）、调腾讯 `web.ifzq.gtimg.cn`（日K前复权）+ `qt.gtimg.cn`（实时，新浪 `hq.sinajs.cn` 兜底），统一代码格式如 `600519.SH` / `000001.SZ` |
| 2 | `core/connectors/providers/src/cn_equity/capabilities.toml`（新增） | 声明免 key、`asset_types = ["equity", "etf", "index"]`、周期 `1d`/`1w`（及可选 `5m`/`15m`/`1h`）、限速与 `poll_secs` |
| 3 | `core/connectors/providers/src/lib.rs` | 导出 `pub mod cn_equity;` |
| 4 | `core/otw-core/src/histdata/caps.rs` & `histdata/native.rs` | 注册 `CN_EQUITY` `Capability` 静态表及 `NativeConnector` 工厂分支 |
| 5 | `core/otw-core/src/exchanges/calendars.json` | 补加 `XSHE`（深交所），补全 `XSHG`/`XSHE` 2027 年节假日 |
| 6 | `core/otw-core/src/portfolios/prices.rs` & `portfolios_import/mod.rs` | 将 `cn_equity` 加入 `PROVIDERS` 与 `fetch_spot_usd()`（拉 CNY 现价后走 `journal_fx::convert(..., "CNY", "USD")`） |
| 7 | `core/otw-core/src/watchlists/quotes.rs` | 在 `default_quote_ticker` 补 `cn_equity` 规则并透传 `currency = "CNY"` |
| 8 | `frontend/src/lib/ui/symbolFormats.js` + `labels.zh.json` | 增加 A 股代码填写示例提示（如 `600519.SH`, `000001.SZ`）与中文标签 |

**建议**：**先花 3 小时用方案 1 跑通验证腾讯/新浪接口在法国 VPS 上的稳定性与复权精度**，确定数据源满意后，再视强迫症程度决定是否迁入方案 2。

---

## 专题问答 B：加密支持深度（OKX、Binance 与永续合约完整度）

### B.1 现有 OKX 支持到什么程度？（只读持仓？下单？）

| 能力项 | 支持程度 | 细节与局限（附 `file:line`） |
| :--- | :--- | :--- |
| **公开行情与 K 线** | **完整可用（免 Key）** | 支持 SPOT / SWAP（永续）/ FUTURES 全部品种搜索、全周期 `1m`~`1w` 历史 K 线（300 根/页，日/周线按 UTC 锚定 `1Dutc`/`1Wutc`）、免 key WS 实时 K 线（`/ws/v5/business`）与盘口 BBO（`bbo-tbt` on `/ws/v5/public`）（`okx/capabilities.toml:12,24`、`okx/stream.rs:1-5,102`、`histdata/caps.rs:596-620`） |
| **账户只读（余额/持仓/委托/成交）** | **基本可用（风控字段残缺）** | 需 `api_key` + `api_secret` + `api_passphrase`，支持 `env=live\|demo` 及区域主机 `region=global\|eea\|us`（法国用户若用欧盟牌照需填 `eea` 指向 `my.okx.com`，`brokers/caps.rs:769-777`、`okx/PROVIDER.md:57-60`）。支持读账户余额、活跃持仓、挂单（含 `orders-algo-pending` 算法挂单）以及 5 类品种（SPOT/MARGIN/SWAP/FUTURES/OPTION）**近 90 天成交**（`okx/account.rs:37,183-223`、`brokers/caps.rs:798`） |
| **交易下单（现货 & U本位永续 & 交割）** | **受限且高风险（E2D 未实测）** | 代码实现了 `spot`/`swap`/`futures` 的下单、改单、撤单（`brokers/native_trade_okx.rs:137-152`），**但成熟度为 `ExecLevel::E2D`**（作者明言 *“built from documentation alone: no account, no demo key, no canary”*，`okx/PROVIDER.md:120-121`、`okx/capabilities_swap.toml:14`），实盘开关需强行勾选「接受未测试风险」并设 3 道金额/仓位硬限额（`brokers/live.rs:74-112`、`brokers/native_trade.rs:13-17`）。功能上**仅有市价单与限价单**（`gtc`/`ioc`/`fok`/`post_only`、单向持仓 `reduce_only`），**不支持止损单、不支持附带止盈止损（TP/SL）、不支持追踪止损、不支持 OCO、不支持币本位反向合约、不支持调杠杆/全逐仓切换、不支持 dry-run 与断线撤单**（`okx/PROVIDER.md:173-175,314-321`、`okx/capabilities_swap.toml:4-14`） |

### B.2 Binance 有没有？做到什么程度？

**有，而且是目前全仓库完成度最高的加密交易所连接器！** 分为两个独立连接器：
- **Binance Spot（`binance`）**：免 key 公开历史（1000 根/页）+ 全周期 WS；账户只读 + 交易下单达到 **`ExecLevel::E4`（真实账户验证通过）**（`core/connectors/providers/src/binance/capabilities.toml:67`、`brokers/caps.rs:57-79`）。
- **Binance USDⓈ-M Futures（`binance_futures`）**：免 key 公开历史（1500 根/页）+ 全周期 WS；账户读余额/持仓/挂单/近 90 天成交（按品种按周拉取）+ 交易下单同样达到 **`ExecLevel::E4`（实测级）**，完整支持市价/限价/止损市价/止损限价/追踪止损/MIT/LIT、按标记价或最新价触发、`close_position` 与断线撤单（`core/connectors/providers/src/binance/capabilities_usdm.toml:55-68`、`binance/trade.rs:1-17`、`brokers/caps.rs:91-118`）。**仅缺 Coin-M 币本位反向合约**（`brokers/caps.rs:102`）。

### B.3 永续合约的持仓 / 资金费 / 强平价显示是否完整？

**结论：不完整，处于「仅能看到张数/均价/浮盈，所有核心风控字段全空」的状态。** 逐层证据如下：

| 关键永续字段 | OKX API 是否返回 | `otw-connector-model` 标准仓位模型 | OKX / Binance 解析代码 | OTW `brokers::Position` | 前端 `BrokerTabs.svelte` 显示 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 方向 / 数量 / 开仓均价 / 浮盈 | 是 | 有（`event.rs:224-240`） | 已解析（`okx/account.rs:493-518`） | 有（`brokers/mod.rs:177-214`） | **已显示**（`BrokerTabs.svelte:402-415`） |
| **标记价（`markPx`）** | 是 | 有字段 `mark_price`（`event.rs:236`） | **硬编码 `None`！**（`okx/account.rs:511`、`binance/account.rs:370`） | 有字段 `market_price` | 仅在非空时显示（OKX/Binance 均为空） |
| **杠杆倍数 & 保证金模式** | 是（`lever`, `mgnMode`） | 无标准字段（`event.rs:224-253`） | OKX 未解析（`okx/account.rs:249-263`） | 有字段 `leverage`/`margin_mode`（`brokers/mod.rs:211-213`） | 有显示逻辑但 OKX 传空 |
| **强平价（`liqPx` / `liquidationPrice`）** | 是 | **缺失** | **未解析**（全仓 0 处解析） | **缺失** | **无此列** |
| **资金费率 & 累计资金费** | 是（`fundingFee` + 费率接口） | 仅空壳 `DataType::FundingRate`（`command.rs:19`） | **未实现**（`testkit/src/lib.rs:145`） | **缺失** | **无此列** |
| **持仓保证金 / 维持保证金率** | 是（`imr`, `mmr`, `mgnRatio`） | **缺失** | **未解析** | **缺失** | **无此列** |

> 叠加缺口 2：Portfolio Tracker 目前完全不支持永续做空与保证金估值模型，因此即便在 OKX 上能看到持仓，同步到 Portfolio Tracker 也会失真。

---

## 专题问答 C：回测引擎数据粒度、撮合假设与跨市场混跑评估

### C.1 数据粒度与策略形态
- **版本与引擎架构**：当前为 **ENGINE_VERSION = 7**（经过 2026-10 未来函数专项审计，`core/otw-core/src/backtest/mod.rs:84-100`），确定性无状态模拟，支持三类策略：`signals`（多条件组合信号，含 32 个内置指标 + 自定义节点图 DAG + **Pine Script v5/v6 VM** `otw-script`）、`grid`（网格，仅限单标的 `backtest_api.rs:142-149`）、`dca`（定投/再平衡）（`backtest/mod.rs:3494-3499`、`backtest/specs.rs:68-101`、`backtest/script.rs:80`）。
- **K 线粒度**：支持 7 个标准周期 `1m, 5m, 15m, 1h, 4h, 1d, 1w`（`histdata/mod.rs:570`）；此外支持两项高仿真增强：
  1. **Intrabar 下钻分辨率**：当同一根大周期 K 线内同时触及止损和止盈（或限价单成交后同根触发止损）时，可开启 `execution.intrabar` 自动读取低周期子 K 线（`1m`~`4h`，缓存于 `histdata_intrabar_cache`）判定真实先后顺序（`backtest/mod.rs:5481-5550`、`intrabar.rs:37`）；
  2. **历史 Bid/Ask 报价撮合**：支持 `use_quotes` 使用历史买卖价（有数据则用真实盘口价，无数据回退固定点差 `spread_pct`，`backtest/mod.rs:855,3505`）。
- **体量上限**：单次组合最多 **8 个数据集**（`backtest_api.rs:123-125`），总 K 线数硬上限 **400,000 根**（单数据集最高 200,000 根，`backtest_api.rs:34,785`），支持样本内外切分（OOS Split）、网格参数扫描（带 `compute_gate` 并发保护）与前复权比率回溯调整（读取 `adj_close` 自动缩放 OHLC，若源无 `adj_close` 会发告警，`backtest_api.rs:235-259,326-331`）。

### C.2 核心撮合与风控假设（核实清单）

| 机制 | 实际实现与源码证据 | 实用评价 |
| :--- | :--- | :--- |
| **信号与成交时机（无未来函数）** | 指标与信号在 `bar - 1` 收盘确认，市价单在**下一根 `bar` 开盘价**成交；`exit_on_reverse` 与过期离场限价单同样在次根开盘退出（`backtest/mod.rs:5,84-86,3651,3801-3862`） | 非常规范，无常见回测偷看收盘价问题 |
| **同 K 线止损/止盈先后** | 开仓当根即开始检验止损/止盈；若单根 K 线同时触及且未开 `intrabar` 或无子 K 线，一律按**最坏情形（先触发止损）**处理（`backtest/mod.rs:74-78,5488-5511`） | 保守偏严谨，不虚高收益 |
| **跳空成交** | 若开盘价已越过止损价，按**开盘价**而非止损挂单价成交；止盈视为挂限价单，开盘越过则按开盘价成交，不扣滑点点差（`backtest/mod.rs:59-60,75-77`） | 贴近美股/A股隔夜跳空现实 |
| **限价单成交规则** | 支持 `touch`（触及即成）或 `through`（严格穿透才成），可选 `maker_fee` 与有效 bar 数（`backtest/mod.rs:729-757,3510-3518`） | 颗粒度高，对加密做市/挂单策略友好 |
| **滑点 / 手续费 / Tick 舍入** | 支持百分比或固定 tick 滑点、按比例或固定额手续费、`tick_size` 向不利方向取整、入场费实时从现金扣除（`backtest/mod.rs:93-96,633-690`） | 细致到位 |
| **数据空洞保护** | 自动检测时间序列空洞（`holes::find`），不允许持仓穿越空洞，空洞前强制平仓并记入 `excluded_trades` 不污染收益统计，空洞后重新冷启动预热指标（`backtest/mod.rs:3548,3580-3581,4342-4359`） | 设计非常考究 |
| **永续资金费率** | **仅为常量估算**（`Funding { annual_rate_pct, interval_hours }`），按每行跨过的时间比例线性计提，多头付/空头收（`backtest/mod.rs:710-725,4361-4384`） | **不支持真实历史资金费率序列**，高波动期误差明显 |
| **保证金与爆仓** | `margin_free = equity - committed_margin` 仅用于**拦截新开仓/加仓**（`backtest/mod.rs:5694-5720`）；主循环逐行 MTM 时**没有任何强平/穿仓判断**（`backtest/mod.rs:4386-4400`，注：`liquidat` 关键词仅出现在网格策略的手动熔断止损 `stop_below`/`stop_above` 中，`mod.rs:4728,4947`） | **致命盲区**：高倍杠杆永续回测若不设止损，净值会跌成负数而不会爆仓！ |
| **A 股特有限制** | **完全没有** T+1 卖出锁定、±10%/±20% 涨跌停一字板无法成交拦截、科创/创业板差异规则、印花税单边计收 | 跑 A 股需人工设 `lot_step=100`、保守滑点并警惕同日开平信号 |

### C.3 能不能直接喂「美股日线 + A 股日线 + 加密 K 线」一起回测？限制在哪？

**短回答：技术上只有在全部为同一周期（如全 `1d`）时 API 才放行，但业务上「强烈不建议直接混在一次运行里跑」，应分市场独立跑。** 六大硬限制如下：

1. **周期必须完全一致**：`backtest_api.rs:310-319,628-637` 硬校验所有数据集 `timeframe` 相同，**不能**喂「美股 `1d` + A股 `1d` + 加密 `1h`」；必须全部降为 `1d`（或全部升为相同分钟周期，但日内跨时段对齐不支持分桶，`align.rs:130-133`）。
2. **完全无币种换算（最隐蔽的算术错误）**：引擎全程按单一无币种现金池 `starting_capital` 记账（`backtest/mod.rs:3625`、`insights/sources.rs:10-12`）。把 USD 美股、CNY A股、USDT 加密塞进同一次回测，会导致 100 元人民币的 A股盈亏直接等价于 100 美元的美股盈亏！
3. **全局共用唯一一套 `Instrument`、`Fees` 与 `Funding` 参数**：`Settings` 中 `instrument`（`multiplier`/`lot_step`/`tick_size`）、`fees`、`funding` 是全局单份（`backtest/mod.rs:1367-1394`）。无法在同一次运行里让 A股按 `lot_step=100` 计手、美股按 `lot_step=1` 计股、同时只给加密永续扣资金费率而不扣股票。
4. **跨时区日历与 7×24 错位**：日线通过 `align.rs:106,138-139` 截取 RFC3339 UTC 字符串前 10 位 `YYYY-MM-DD` 做 `Union` 合并；加密在周六/周日及中美节假日持续产生 bar，股票对应 `bar_at_row[r] = None`（保留上一收盘价估值），且 A股（UTC+8 15:00 收盘）与美股（UTC-5/-4 16:00 收盘）虽落在同一 UTC 日期但开收盘先后相差十余小时，组合级风控与仓位抢占受顺序影响（`backtest/mod.rs:3726-3729` 按开盘时间戳排序）。
5. **数据集数量与总 bar 限制**：单次运行最多 8 个标的、总计不超过 40 万根 K 线（`backtest_api.rs:34,123-125`），只适合精选核心标的组合，不适合全市场股票池截面选股回测。
6. **A 股与永续各自仿真短板**：A股缺 T+1 与涨跌停撮合限制；加密永续缺真实历史资金费率与维持保证金强平机制。

**实操建议**：在当前引擎版本下，**按市场建 3 套策略模板分别回测**（美股 USD、A股 CNY+`lot_step=100`、OKX 永续 USDT+强制加止损+设保守年化 `funding`），再用 Quant Tools 的多运行对比（`/api/quant/compare`，`quant_api.rs:16,54`）对三个市场的回测净值曲线做相关性与组合评估——这既规避了单引擎跨币种 Bug，又直接用上了现有最强的量化对比能力。
