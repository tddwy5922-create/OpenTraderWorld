# OpenTraderWorld 功能模块评估报告

> **评估视角**：单人自托管、中文界面环境；核心标的为**美股（主）· A 股 · 加密（OKX 永续为主）**；核心诉求为**实盘持仓看板 + 行情 + 回测 + 交易日志 + 新闻研究**，拒绝空壳模块。  
> **评估基准**：以仓库当前代码实际实现为准（前端模块注册表 `frontend/src/lib/modules/registry.js` 全部 34 个模块 + 对应 `frontend/src/routes/` 与 `core/otw-core/src/`、`core/otw-store/src/`、`core/connectors/` 实现）。凡无直接代码证据的推断均标注「推测」。

---

## 1. 模块总表（全部 34 个注册模块，无遗漏）

> 说明：模块列表与顺序严格对照 `frontend/src/lib/modules/registry.js:14-266`。  
> 底层数据前提：23 个内置行情/券商连接器全部面向美股/全球股或海外加密交易所（`core/connectors/providers/src/lib.rs:4-49`），**无任何内置 A 股券商或国内数据源**（A 股仅能靠 Yahoo `.SS`/`.SZ`、付费 EODHD `.SHG`/`.SHE`、IBKR 沪深港通，或通过 `histdata` 自定义 HTTP/Push 源 `core/otw-core/src/histdata/kinds/mod.rs:32` 自行接入）；OKX 永续行情/账户读取完整（`core/connectors/providers/src/okx/capabilities.toml:8`、`core/connectors/providers/src/okx/account.rs:1-250`），但**实盘下单成熟度仅为 E2D（无账号、无演示盘、纯照文档编写）且不支持条件止损与挂靠止盈止损**（`core/connectors/providers/src/okx/PROVIDER.md:120,175`、`core/connectors/providers/src/okx/capabilities_swap.toml:1-14`）。

| # | 模块名 (`id`) | 一句话定位 | 核心文件 | 完成度（含代码证据） | 依赖的数据源 | 美股·A股·加密适配度 | 结论 |
|---|---|---|---|---|---|---|---|
| 1 | 仪表盘 (`dashboard`) | 12 列自由网格总览页，聚合各模块小组件与预设工作区 | `frontend/src/routes/+page.svelte`、`frontend/src/lib/modules/dashboard/layout.js`、`widgets/registry.js`、`core/otw-core/src/dashboard_api.rs` | **可用**：完整 CRUD、6 套预设、30+ 小组件注册表（`widgets/registry.js:25-577`），但**无券商实时持仓小组件**（仅读 `portfolios`/`journal` 离线账本，`PortfolioWidget.svelte:40-58`、`JournalStatsWidget.svelte:72,99`），且多处跳转丢参数（`HistvizWidget.svelte:104,119`、`BacktestWidget.svelte:154`） | 各模块 API（`portfolios`/`watchlists`/`journal`/`news` 等） | 美股:**好** / A股:**一般** / 加密:**差**（无 OKX 实时仓位，数量小数被截断 `JournalStatsWidget.svelte:303`） | **需补强** |
| 2 | 编辑器 (`editor`) | 类 Notion 块级文档、内嵌表格数据库与版本历史 | `frontend/src/routes/editor/`、`frontend/src/lib/modules/editor/`、`core/otw-core/src/documents.rs`、`databases.rs` | **可用**：完整文档/版本/结构化表 CRUD 与文件上传（`documents.rs:1-200`、`data_admin.rs:23-27`） | 本地 PostgreSQL + `/data/uploads` | **不适用**（通用笔记工具） | **建议砍掉**（单人已有外部笔记工具时维护冗余） |
| 3 | 新闻资讯 (`news`) | 多看板 RSS + 自定义 JSON API 轮询新闻流与 SSE 推送 | `frontend/src/routes/news/+page.svelte`、`frontend/src/lib/modules/news/FeedForm.svelte`、`core/otw-core/src/feeds_api.rs`、`main.rs:463-465` | **可用**：支持 RSS/JSON API 路径映射、Vault 密钥引用、配额追踪、SSE 实时推送（`FeedForm.svelte:86-104`、`news/api.js:21-79`）；但**零内置中文/美股/加密预设源**，无标的自动标签 | 用户自配 RSS URL 或第三方新闻 JSON API | 美股:**一般** / A股:**一般** / 加密:**一般**（全靠手动配源；自选新闻角标中文正则失效 `otw-store/src/watchlists.rs:583-602`） | **需补强** |
| 4 | 邮箱 (`mailbox`) | 只读 IMAP 邮件同步、发件人统计与附件查看 | `frontend/src/routes/mailbox/`、`core/otw-core/src/mailbox_api.rs`、`main.rs:558` | **可用**：完整 IMAP 轮询与附件存储（`data_admin.rs:166-177`、`main.rs:558`） | 外部 IMAP 邮箱 | **不适用**（办公工具） | **建议砍掉** |
| 5 | 交易日志 (`journal`) | 交易记录、多腿 FIFO、纪律标签、3D 复盘与券商自动同步 | `frontend/src/routes/journal/`、`frontend/src/lib/modules/journal/Trades.svelte`、`TradeForm.svelte`、`core/otw-core/src/journal_api.rs`、`journal_import_api.rs`、`journal_import/broker.rs` | **可用**：后端与分析极完整（FIFO/MAE/MFE/3D 散点/定时券商同步）；但**不支持 USDT/USDC**（`journal/api.js:423-436`、`journal_fx.rs:21-23`）、CSV 自动识别**零中文表头**（`import/dict.rs:60-200`）、OKX 超 90 天持仓会卡死增量同步（`journal_import/broker.rs:545-551`） | 券商 API（IBKR/OKX 等）、Frankfurter/er-api 汇率（`fx.rs:17-18`）、CSV/Excel 导入 | 美股:**好** / A股:**差**（无券商直连且无中文 CSV 识别） / 加密:**一般**（缺 USDT 与 90 天窗口限制） | **需补强** |
| 6 | 订阅管理 (`subscriptions`) | 个人周期性订阅支出、续费提醒与预算告警 | `frontend/src/routes/subscriptions/`、`core/otw-core/src/subscriptions_api.rs`、`main.rs:550` | **可用**：完整 CRUD + 小时级续费提醒循环（`main.rs:550`、`data_admin.rs:48-52`） | 手动录入 | **不适用**（个人记账） | **建议砍掉** |
| 7 | 时间追踪 (`time`) | 项目计时器、工时统计与费率估值 | `frontend/src/routes/time/`、`core/otw-core/src/time_api.rs` | **可用**：完整计时/项目/工时统计（`data_admin.rs:53-57`） | 手动录入 | **不适用**（个人效率） | **建议砍掉** |
| 8 | 净资产 (`wealth`) | 个人资产负债表（房产、贷款、银行卡）与估值历史 | `frontend/src/routes/wealth/`、`core/otw-core/src/wealth_api.rs`、`main.rs:546` | **可用**：完整资产/贷款摊还/陈旧估值提醒（`main.rs:546`、`data_admin.rs:58-67`） | 手动录入（与 `portfolios` 数据隔离） | **不适用**（偏家庭财务而非交易） | **建议砍掉** |
| 9 | 目标管理 (`goals`) | 个人/财务目标进度条与截止日期追踪 | `frontend/src/routes/goals/`、`core/otw-core/src/goals_api.rs` | **可用**：完整单表 CRUD（`data_admin.rs:68`） | 手动录入 | **不适用**（个人效率） | **建议砍掉** |
| 10 | 待办事项 (`todos`) | 个人任务清单与截止日期分组 | `frontend/src/routes/todos/`、`core/otw-core/src/todos_api.rs` | **可用**：完整单表 CRUD（`data_admin.rs:69`） | 手动录入 | **不适用**（个人效率） | **建议砍掉** |
| 11 | 交易例行 (`routines`) | 盘前/盘后检查清单与打卡连续天数 | `frontend/src/routes/routines/`、`core/otw-core/src/trader_tasks_api.rs` | **可用**：4 张表支持模板/打卡/快捷任务（`data_admin.rs:70-79`） | 手动录入 | **不适用**（纪律辅助，非核心刚需） | **建议砍掉** |
| 12 | 交易心态 (`mindset`) | 交易前后情绪问卷打卡与情绪分布统计 | `frontend/src/routes/mindset/`、`core/otw-core/src/mindset_api.rs` | **可用**：2 张表完整实现（`data_admin.rs:80-84`） | 手动录入 | **不适用**（可用 `journal` 纪律标签替代） | **建议砍掉** |
| 13 | 提醒通知 (`remindme`) | 定时提醒与外部通知通道（Email/TG/Slack/Discord） | `frontend/src/routes/remindme/`、`core/otw-core/src/reminders_api.rs`、`notif_channels_api.rs`、`main.rs:542` | **可用**：独立调度器 + 外部推送通道（`main.rs:542`、`data_admin.rs:85`）；注意：通知通道基础设施位于独立 `notif_channels_api`（`main.rs:654`），`watchlists`/`histviz` 告警不依赖本模块页面 | 内部定时 + 外部推送 Webhook/SMTP | **不适用**（通用提醒） | **建议砍掉**（保留底层 `notif_channels_api` 即可） |
| 14 | 金融数据库 (`findb`) | FinanceDatabase 静态金融标的名录检索与收藏夹 | `frontend/src/routes/findb/`、`core/otw-core/src/findb_api.rs` | **可用**：本地批量导入与收藏夹管理（`data_admin.rs:86-91`），但为离线静态名录且无实时行情 | GitHub `FinanceDatabase` 静态 CSV 导入 | 美股:**好** / A股:**一般** / 加密:**差**（无永续合约） | **建议砍掉** |
| 15 | 日历 (`calendar`) | 通用日程表，聚合 RemindMe/ToDo/Goals 到期项 | `frontend/src/routes/calendar/+page.svelte`、`core/otw-core/src/calendar_api.rs` | **可用**：完整事件 CRUD + 跨效率模块聚合（`data_admin.rs:92`），但**不联动财报/除息/交易日志** | 手动录入 + `todos`/`goals`/`remindme` | **不适用**（通用个人日历） | **建议砍掉** |
| 16 | 经济日历 (`economics`) | 宏观经济数据发布日历 | `frontend/src/routes/economics/+page.svelte`、`frontend/src/lib/modules/economics/EconomicCalendar.svelte` | **空壳**：仅 82 行前端组件直接注入 TradingView 外部 iframe 脚本（`EconomicCalendar.svelte:21-31`），**零后端路由、零数据库表**（`data_admin.rs:226`），且硬编码 `locale: 'en'`（`EconomicCalendar.svelte:26`）与 `colorTheme = 'dark'`（`routes/economics/+page.svelte:16`） | TradingView 外部第三方嵌入脚本 | 美股:**一般** / A股:**差**（未配中国过滤且全英文） / 加密:**差** | **建议砍掉** |
| 17 | 基本面 (`fundamentals`) | 美股财报、SEC 文件、内部人交易与宏观 FRED 序列分析 | `frontend/src/routes/fundamentals/`、`core/otw-core/src/fundamentals/mod.rs`、`edgar.rs`、`datasets.rs`、`fundamentals_api.rs` | **可用**：11 张表深度实现（`data_admin.rs:207-223`），支持 EDGAR XBRL/Form 4、FRED、Treasury、FMP/Finnhub/EODHD/FINRA（`fundamentals/mod.rs:43-67`、`datasets.rs:35-52`） | SEC EDGAR、FRED、Treasury、FMP/Finnhub/EODHD 等 | 美股:**好** / A股:**差**（EDGAR 仅美股，无巨潮/CNINFO） / 加密:**差** | **保留（选装，美股深研用）** |
| 18 | 历史数据 (`histdata`) | K 线/行情数据下载队列、连接器管理与自定义源导入底座 | `frontend/src/routes/histdata/`、`frontend/src/lib/modules/histdata/api.js`、`core/otw-core/src/histdata_api.rs`、`histdata/native.rs`、`histdata/kinds/mod.rs` | **可用**：支持 23 个原生连接器、CSV 导入、定时增量刷新、以及**自定义 HTTP/Push 数据源模板**（`histdata/kinds/mod.rs:32`、`main.rs:476-483`）；是 `histviz`/`backtest`/`scanner`/`quant` 的硬依赖（`registry.js:149,158,197,213`） | 23 个内置连接器 + CSV 导入 + 自定义 HTTP/Push 源 | 美股:**好** / A股:**一般**（需自配 HTTP/Push 或 Yahoo/EODHD） / 加密:**好**（OKX 现货/永续历史全支持 `okx/capabilities.toml:8`） | **需补强**（核心底座，补 A 股预设模板） |
| 19 | K 线图表 (`histviz`) | TradingView 风格多图网格、技术指标、画线、实时流、券商持仓与图上下单 | `frontend/src/routes/histviz/+page.svelte`、`frontend/src/lib/modules/histviz/Pane.svelte`、`OrderTicket.svelte`、`BrokerTabs.svelte`、`QuickPanel.svelte`、`core/otw-core/src/histviz_api.rs` | **可用（全仓库最成熟模块）**：多窗格网格、WS 复用流、画线、自定义脚本、价格告警、实时持仓/挂单线拖拽改单、下单自动关联日志（`journal_import/chart.rs:36-168`）；缺陷：时间轴硬编码英文（`timeAxis.js:20-21`）、OKX 下单 E2D 未经实盘且无止损单（`okx/PROVIDER.md:120`）、快速回测无法导出（`QuickPanel.svelte:269-294`） | `histdata` 存储 + 23 连接器实时 WS + `brokers` 实盘账户 | 美股:**好** / A股:**一般**（依赖自配数据源，无 A 股券商） / 加密:**好**（OKX 永续 WS 行情与持仓展示完备，实盘下单谨慎） | **需补强** |
| 20 | 策略回测 (`backtest`) | 信号/网格/定投回测引擎、样本外检验、参数网格优化与逐笔复盘图 | `frontend/src/routes/backtest/+page.svelte`、`frontend/src/lib/modules/backtest/steps/`、`core/otw-core/src/backtest/mod.rs`、`backtest_api.rs`、`backtest_optimize_api.rs` | **可用**：Rust v7 引擎非常扎实（无未来函数审计、逐 K 线/子周期撮合、杠杆/滑点/挂单/网格/DCA、仅 1 处 TODO 在优化器 `backtest_optimize_api.rs:119`）；但资金费率仅支持固定年化常数（`backtest/mod.rs:710-725`），无 A 股 T+1/涨跌停/单边印花税规则 | `histdata` 已下载数据集 | 美股:**好** / A股:**差**（无 T+1、无涨跌停撮合、无单边印花税） / 加密:**一般**（仅有固定常数资金费率、无强平模拟） | **需补强** |
| 21 | 交易机器人 (`robots`) | 将回测策略部署为自动定时执行的纸面/实盘策略机器人 | `frontend/src/routes/robots/`、`core/otw-core/src/robots/api.rs`、`main.rs:729-731` | **半成品**：完整 9 张表与纸面执行框架（`data_admin.rs:101-115`），但**实时流模式尚未实现**——`robots/api.rs:142-148` 显式硬拒 `feed == "live"`（返回 `"the live feed is not available yet — use the stored feed"`）；叠加 IBKR 仅 E1 纸面（`ibkr/PROVIDER.md:244-250`）与 OKX E2D 未验证（`okx/PROVIDER.md:120`），不可用于实盘无人值守 | `backtest` 策略 + `histdata` 定时刷新 + `brokers` | 美股:**差** / A股:**差** / 加密:**差** | **建议砍掉** |
| 22 | 机构持仓 (`mportfolios`) | 抓取美股知名基金经理 13F 季度持仓与调仓变动 | `frontend/src/routes/mportfolios/`、`core/otw-core/src/mportfolios_api.rs`、`main.rs:486-488` | **可用**：自动抓取 Dataroma 13F 数据与持仓变动对比（`mportfolios_api.rs:3-6`、`data_admin.rs:116-120`） | Dataroma 公开网页抓取（纯美股 13F，滞后 45 天） | 美股:**一般** / A股:**不适用** / 加密:**不适用** | **建议砍掉** |
| 23 | 投资组合追踪 (`portfolios`) | 多币种持仓账本、净值曲线、分红收入、配置分析与券商持仓导入 | `frontend/src/routes/portfolios/`、`frontend/src/lib/modules/portfolios/PortfolioDetail.svelte`、`core/otw-core/src/portfolios_api.rs`、`portfolios/prices.rs`、`portfolios_import/broker.rs`、`otw-store/src/portfolios/ledger.rs` | **半成品**：现货多头账本功能齐全，但存在**两个致命硬伤**：① `portfolios_import/broker.rs:45-83,175,403,419-435` 导入 OKX 永续空单为 `sell` 操作，而 `ledger.rs:108-126,182-189` 是纯多头账本，空单数量直接归零并把卖出金额计成**虚假已实现盈利**；② 报价源仅限 `coingecko\|yahoo\|binance\|kraken\|coinbase`（`portfolios_api.rs:395,580`），**缺 OKX 且不复用 `histdata` 连接器**（`portfolios/prices.rs:324-335`）；③ 币种列表缺 `HKD`/`USDT`/`USDC`（`portfolios/api.js:285`） | CoinGecko / Yahoo / Binance / Kraken / Coinbase + 手动/CSV/券商导入 | 美股:**好** / A股:**一般**（Yahoo `.SS`/`.SZ` 可报 CNY 但缺国内券商同步） / 加密:**差**（OKX 永续空单算错且无 OKX 报价） | **需补强** |
| 24 | 自选股 (`watchlists`) | 多分组自选报价表、热力图/相关性视图、价格预警、新闻角标与目标价 | `frontend/src/routes/watchlists/`、`frontend/src/lib/modules/watchlists/WatchlistDetail.svelte`、`views.js`、`api.js`、`core/otw-core/src/watchlists_api.rs`、`watchlists/quotes.rs` | **半成品**：UI 丰富且有后台预警轮询（`main.rs:499-507`），但代码存在多处未完工/错误：① `pe` 和 `div_yield` 显式写死 `null`（`watchlists/quotes.rs:281-283`）；② 添加标的仅限 `coingecko\|yahoo`（`watchlists_api.rs:377-382`），无法直接搜索 OKX 永续；③ Yahoo 原币种价格（如茅台 CNY）直接塞进 `price_usd` 且前端 `fmtQuote` 硬编码 `'USD'`（`quotes.rs:70-78,266`、`watchlists/api.js:152-157`），导致 A 股显示美元符号 `$`；④ `default_quote_ticker` 漏掉 `okx` 分支（`quotes.rs:697-712`） | CoinGecko / Yahoo + 可选单行绑定 `histdata` 连接器 | 美股:**好** / A股:**差**（A 股标 `$` 符号且新闻正则匹配失效） / 加密:**差**（无 OKX 永续映射，默认 CoinGecko 行打不开图表 `quotes.rs:389`） | **需补强** |
| 25 | 扫描器 (`scanner`) | 基于技术指标信号的多标的蜂窝/折线/表格条件选股与定时告警 | `frontend/src/routes/scanner/`、`core/otw-core/src/scanner_api.rs`、`main.rs:531-538` | **可用**：8 张表 + 后台定时扫描 + 命中一键跳转 `/histviz`（`data_admin.rs:132-145`、`routes/histviz/+page.svelte:1201-1224`） | `histdata` 连接器与历史 K 线 | 美股:**好** / A股:**一般**（依赖自建 A 股源） / 加密:**好** | **保留（选装，盘中选股用）** |
| 26 | 税务计算器 (`taxcalc`) | 多国资本利得税估算、年度结转亏损与多情景模拟 | `frontend/src/routes/taxcalc/`、`core/otw-core/src/taxcalc_api.rs`、`taxcalc.rs`、`taxcalc/regimes/` | **可用（地域不匹配）**：完整 FIFO/结转计算，但内置税制仅含美/英/法/德/西/意/瑞/澳 9 个西方国家（`taxcalc.rs:23-64`），**无中国大陆/香港税制** | `journal` / `brokers` 成交记录 | **不适用**（中国税务居民无对应税制） | **建议砍掉** |
| 27 | 量化工具 (`quant`) | 单标的/组合风险指标、相关性矩阵、季节性热力图与 HMM 状态识别 | `frontend/src/routes/quant/`、`core/otw-core/src/quant_api.rs`、`quant_market_api.rs` | **可用**：无自有存储表（`data_admin.rs:227`），纯后端实时计算 VaR/CVaR/相关性/季节性/波动率/隐马尔可夫状态 | `histdata` 已下载数据集 + `backtest` 结果 | 美股:**好** / A股:**一般** / 加密:**好** | **建议砍掉**（与 `backtest`/`watchlists` 相关性视图重叠，除非重度因子研究） |
| 28 | 期权 (`options`) | 期权链查询、Greeks、到期损益图与多腿策略构建 | `frontend/src/routes/options/`、`core/otw-core/src/options_api.rs` | **可用（市场受限）**：完整 BS 定价与策略损益，但后端硬限制仅支持 `equity\|etf\|index` 且仅限 `massive\|ibkr\|alpaca`、纽约时区日历（`options_api.rs:46,142-152`） | Massive / IBKR / Alpaca 期权链 | 美股:**好** / A股:**差**（不支持上证/深证 ETF 期权） / 加密:**差**（不支持 OKX/Deribit 加密期权） | **建议砍掉**（需求未提及期权，且不支持加密/A 股期权） |
| 29 | 资源书签 (`resources`) | 网址收藏夹、分类标签与元数据抓取 | `frontend/src/routes/resources/`、`core/otw-core/src/resources_api.rs` | **可用**：2 张表完整实现（`data_admin.rs:157`） | 用户手动收藏 URL | **不适用**（浏览器书签替代） | **建议砍掉** |
| 30 | 提示词库 (`prompt-store`) | AI Prompt 模板保存、标签分类与版本历史 | `frontend/src/routes/prompt-store/`、`core/otw-core/src/prompts_api.rs` | **可用**：2 张表含版本回滚（`data_admin.rs:158-163`） | 本地 PostgreSQL | **不适用**（AI 辅助附属品） | **建议砍掉** |
| 31 | 社区文档 (`community-docs`) | 拉取并收藏 OpenTraderWorld 官方社区教程与提交文档 | `frontend/src/routes/community-docs/`、`core/otw-core/src/community_docs_api.rs` | **可用（纯英文上游）**：硬编码拉取英文官网 `https://opentraderworld.com/api/docs/feed`（`community_docs_api.rs:30,39`） | 外部英文官网 API | **不适用** | **建议砍掉** |
| 32 | Webhooks (`webhooks`) | 接收外部 HTTP POST Webhook 并转发为站内通知 | `frontend/src/routes/webhooks/`、`core/otw-core/src/webhooks_api.rs`、`main.rs:624-629` | **半成品（功能极窄）**：注册表显式注明 `v1's only redirect target is RemindMe notifications`（`registry.js:249-250`），不能直接触发下单、不能写入日志或自选 | 外部推送（如 TradingView Alert） | 美股:**一般** / A股:**一般** / 加密:**一般**（仅做通知中转） | **建议砍掉**（除非用外部 TradingView Webhook 转发通知） |
| 33 | AI 助手 (`agent`) | 内置多模型聊天、MCP 工具调用、技能与记忆系统 | `frontend/src/routes/agent/`、`core/otw-core/src/agent_api.rs`、`main.rs:421-423,603` | **可用**：6 张表 + 内置角色/技能种子 + 外部聊天机器人控制桥（`data_admin.rs:183-194`、`main.rs:603`），需要自备 LLM API Key | OpenAI/Anthropic/OpenRouter 等 LLM API + 内部 MCP 路由 | 美股:**一般** / A股:**一般** / 加密:**一般**（可辅助读新闻/总结日志） | **建议砍掉**（非最小可用核心，后续按需开启） |
| 34 | 自动化 (`automator`) | 可视化定时/事件工作流编排，按计划调用站内 API | `frontend/src/routes/automator/`、`core/otw-core/src/automator_api.rs`、`main.rs:727` | **可用**：6 张表 + 内置调度器与版本历史（`data_admin.rs:195-206`、`main.rs:727`），配置复杂度高 | 站内任意 API 路由 | **不适用**（重度编排工具，单人易沦为维护负担） | **建议砍掉** |

---

## 2. 最有用的前 8 个模块：每个 3 条最值得做的改进

基于「实盘持仓看板 + 行情 + 回测 + 交易日志 + 新闻研究」与「美股·A股·OKX永续」目标，最核心的 8 个模块为：**`portfolios`、`watchlists`、`histviz`、`histdata`、`backtest`、`journal`、`news`、`dashboard`**。

### 模块 1：投资组合追踪 (`portfolios`)

1. **修复 OKX 永续空单被吞仓并伪造已实现盈利的致命账本 Bug**
   - **现象**：从 OKX 导入包含永续合约空单（如 `-2 ETH-USDT-SWAP`）的持仓后，组合里该标的持仓数量变为 `0`，却多出一笔凭空产生的正值「已实现盈利」。
   - **根因**：`core/otw-core/src/portfolios_import/broker.rs:45-83,175,403,419-435` 将券商空头仓位作为 `side = "sell"` 写入操作表，而账本重算引擎 `core/otw-store/src/portfolios/ledger.rs:108-126,182-189` 是纯多头 FIFO 模型，当 `sell` 超过已有买入批次时直接丢弃超出数量并将 `op.gross - op.fee` 计入 `realized`。
   - **具体改法**：在 `ledger.rs` 支持带符号持仓（`short_lots` 队列与 `side` 负数量核算）或区分 `short_open` / `short_close` 操作类型，对永续合约记录保证金与合约乘数，并按 `(entry_price - mark_price) * qty * multiplier` 计算空头浮动盈亏；同时在 `portfolios_import/broker.rs` 导入 OKX SWAP 时写入 `contract_multiplier` 与持仓方向。
   - **验收标准**：在测试组合中导入 1 笔 OKX 空单（数量 `-1`、开仓价 `3000`）且当前价为 `3100`，组合持仓表显示数量 `-1`（或明确标注「空 1」）、未实现盈亏为 `-100`、已实现盈亏为 `0`。

2. **打通 `histdata` 连接器与 OKX 实时报价源，补齐 `HKD` / `USDT` / `USDC` 计价币种**
   - **现象**：持仓里添加 OKX 永续合约或 A 股标的时无法使用已配置的 OKX/自定义 HTTP 连接器刷价，且无法选择 `USDT`/`USDC`/`HKD` 作为资产或组合币种。
   - **根因**：`core/otw-core/src/portfolios_api.rs:395,580` 与 `frontend/src/lib/modules/portfolios/api.js:285-298` 硬编码报价源仅允许 `coingecko|yahoo|binance|kraken|coinbase`、币种仅 10 种（无 `HKD`/`USDT`/`USDC`）；`core/otw-core/src/portfolios/prices.rs:324-335` 独立写 HTTP 调交易所公开接口，未接入 `core/connectors`（`histdata` 连接器体系）。
   - **具体改法**：在 `portfolios/prices.rs` 增加 `connector:<id>` 报价分支，复用 `core/connectors` 读取 OKX 现货/永续最新价及用户自建的 A 股自定义 HTTP 源；在 `CURRENCIES` 与后端校验表补齐 `HKD`、`USDT`、`USDC`（并在 `journal_fx` 中将稳定币默认锚定 `1 USD` 或允许读取实时汇率）。
   - **验收标准**：新建一个 `USDT` 计价组合，加入 `BTC-USDT-SWAP` 并选择已配置的 OKX 连接器，点击「刷新价格」后 3 秒内返回与 OKX 盘口一致的最新价，且港股/A 股资产可选 `HKD`/`CNY`。

3. **支持 A 股券商交割单中文 CSV 自动映射与手动持仓快速快照**
   - **现象**：导入国内券商（同花顺/东方财富/华泰等）导出的中文 CSV 交割单时，列映射全部显示未识别，每次都要逐列手选。
   - **根因**：`core/otw-core/src/import/dict.rs:60-200` 仅包含英/法/西/德/意/葡 6 种拉丁语系同义词，完全没有中文表头词典（如「证券代码」「成交日期」「买卖标志」「成交均价」「成交数量」「手续费」「印花税」）。
   - **具体改法**：在 `core/otw-core/src/import/dict.rs` 为 `TICKER`/`DATE`/`SIDE`/`PRICE`/`QUANTITY`/`FEES`/`AMOUNT` 补充国内主流券商常见中文列名，并在 `value_maps` 增加「证券买入/买」→`buy`、「证券卖出/卖」→`sell` 的默认方向识别，同时支持 GBK/GB18030 编码自动转 UTF-8（同花顺/通达信导出的 CSV 默认常为 GBK，「推测」需核查 `import/parse.rs` 是否已含 GBK 解码）。
   - **验收标准**：上传一份包含「成交日期,证券代码,买卖标志,成交价格,成交数量,手续费」的中文 CSV，预览页无需手动改映射即可自动识别全部 6 列并正确生成买入/卖出操作。

---

### 模块 2：自选股 (`watchlists`)

1. **修复 A 股等非美元标的报价被错误标成美元 `$` 的 Bug**
   - **现象**：在自选股中加入 `600519.SS`（贵州茅台）或 `0700.HK`（腾讯），价格显示为 `$1,500.00` 而非 `¥1,500.00` / `HK$400.00`，市值列同样硬带 `$` 与英文 `T/B/M`。
   - **根因**：`core/otw-core/src/watchlists/quotes.rs:70-78,266` 直接将 Yahoo 返回的原生币种价格写入 `quote["price_usd"]` 且不保存 `currency` 字段；前端 `frontend/src/lib/modules/watchlists/api.js:152-157`（`fmtQuote`）硬编码 `'USD'`，且 `frontend/src/lib/modules/watchlists/views.js:89-99,184-192`（`fmtCap`/`shortPrice`）硬写 `$` 与 `T/B/M/K`。
   - **具体改法**：后端在 `quotes.rs` 从 Yahoo `meta.currency`（或连接器标的元数据）一并写入 `quote["currency"]` 字段（并保留原价为 `price`，兼容读取 `price_usd`）；前端 `fmtQuote(price, currency)` 按行币种渲染（`CNY` 显示 `¥`、`HKD` 显示 `HK$`、`USDT` 显示 `USDT`），并允许中文环境下切换 `万/亿` 单位。
   - **验收标准**：在同一个自选列表中同时加入 `NVDA`（美股）、`600519.SS`（A 股）、`BTC-USDT-SWAP`（OKX），价格列分别显示 `$xxx`、`¥xxx`、`xxx USDT`，不再出现茅台标 `$`。

2. **开放直接通过 `histdata` 连接器（含 OKX 永续、自定义 A 股源）搜索和添加自选**
   - **现象**：添加自选弹窗只能搜 Yahoo 和 CoinGecko，无法添加 OKX 永续合约（如 `BTC-USDT-SWAP`），手工绑定 OKX 连接器时还会因代码格式不对报 `51001`；且默认 CoinGecko 加密货币行在自选表里「打开图表」按钮灰显禁用。
   - **根因**：`core/otw-core/src/watchlists_api.rs:377-382` 硬限制 `add_item` 仅接受 `provider: coingecko|yahoo`、`asset_class: crypto|stock|etf`；`core/otw-core/src/watchlists/quotes.rs:697-712`（`default_quote_ticker`）漏写 `okx` 分支导致发送裸 `BTC` 给 OKX；`watchlists/quotes.rs:389` 对 CoinGecko 默认行返回 `chart_coords = None`，导致 `WatchlistDetail.svelte:938-944` 禁用跳转按钮。
   - **具体改法**：放开 `add_item` 允许 `provider = "connector"`（或直接写入已配置连接器的 `provider` + `connector_id` + `asset_class: perp/future`）；在 `quotes.rs:697-712` 补齐 `okx` 的默认 ticker 拼接规则（现货 `{SYM}-USDT`、永续 `{SYM}-USDT-SWAP`）；当自选行绑定了任意可用行情连接器（或已存在对应 OKX/Binance 连接器）时自动生成有效 `chart_coords`。
   - **验收标准**：在自选添加弹窗中选择已配置的 OKX 连接器搜索并添加 `ETH-USDT-SWAP`，刷新后正常显示实时价格与 24h 涨跌幅，点击该行右侧 K 线图标可直接跳转到 `/histviz` 打开 OKX `ETH-USDT-SWAP` 图表。

3. **清理或补全长期固定为 `n/a` 的估值列，并修复中文新闻角标匹配**
   - **现象**：自选表开启 `P/E` 和 `股息率` 列后所有标的永远显示 `n/a`；且中文新闻流里明明有「贵州茅台」「比特币」新闻，自选行上新闻角标依然是 0。
   - **根因**：`core/otw-core/src/watchlists/quotes.rs:281-283` 显式写死 `"pe": null, "div_yield": null`（注释写明无数据源提供）；`core/otw-store/src/watchlists.rs:583-602` 生成新闻匹配正则时硬套 PostgreSQL 单词边界 `\m...\M`，而中文标题无空格分词且 A 股 Yahoo 名称为英文（`Kweichow Moutai`），导致中文新闻完全匹配不到。
   - **具体改法**：① 从 `fundamentals` 已有缓存快照 `fund_snapshots`（若存在）回填 `pe`/`div_yield`，对不支持的加密标的在列配置中自动隐藏；② 在 `otw-store/src/watchlists.rs:583-602` 对含 CJK 字符的关键词改用不带 `\m\M` 的子串匹配，并允许自选条目维护自定义中文别名（如 `600519.SS` 别名 `贵州茅台,茅台,600519`）。
   - **验收标准**：在新闻模块订阅一条包含「贵州茅台」的中文 RSS 后，给 `600519.SS` 设置别名「贵州茅台」，自选表该行立即出现未读新闻数字角标，点击后跳转到新闻页过滤出对应文章。

---

### 模块 3：K 线图表 (`histviz`)

1. **修复时间轴英文硬编码与持仓表格中文列宽截断**
   - **现象**：在全中文界面下，K 线底部 X 轴和十字光标仍显示 `Mon 27 Oct '26 06:56`；底部持仓面板（`BrokerTabs`）在中文表头或中文账户名下出现文字重叠/截断。
   - **根因**：`frontend/src/lib/modules/histviz/timeAxis.js:20-21,105-108,129-130` 硬编码英文 `MONTHS`/`DAYS` 数组；`frontend/src/lib/modules/histviz/BrokerTabs.svelte:364-400,729-735` 使用 `table-layout: fixed` 并按 `String(v).length` 换算等宽 `ch` 列宽，但 1 个中文汉字占约 `2ch`，导致中文表头/账户名宽度被低估一半。
   - **具体改法**：① `timeAxis.js` 根据当前 `$locale` 输出中文月/日格式（如 `10月`、`周一 27`、`2026-10-27 06:56`）；② `BrokerTabs.svelte:365` 计算字符串视觉宽度时将非 ASCII 字符计为 `2`（`[...s].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)`），并将 `when`/`filledAt`/`opened`（`BrokerTabs.svelte:344-355`）统一改走 `tz.value` 格式化。
   - **验收标准**：中文界面打开任意 15m/1d K 线图，X 轴和十字光标全部显示中文/ISO 24 小时制时间；连接含中文名称的券商账户后，底部「持仓」标签所有列无文字截断或重叠。

2. **补强 OKX 永续实盘能力验证与安全护栏（明确标出 E2D 状态并补止损单）**
   - **现象**：用户若开启 OKX 永续图上下单，无法在界面直观得知该连接器尚未经过真实演示盘验收，且下单面板无法给永续仓位附带条件止损/止盈单，易引发风控事故。
   - **根因**：`core/connectors/providers/src/okx/PROVIDER.md:120,175` 与 `core/connectors/providers/src/okx/capabilities_swap.toml:1-14` 确认 OKX 执行层为 **E2D（仅按文档编写，未经实盘/模拟盘测试）**，且未对接 OKX `/api/v5/trade/order-algo` 条件止损与 `attachAlgoOrds` 挂靠止盈止损；`core/otw-core/src/brokers/native_trade_okx.rs` 也仅下普通限价/市价单。
   - **具体改法**：先用 OKX 模拟盘（`x-simulated-trading: 1`）完整跑通下单/改单/撤单/平仓/持仓 WS 推送验证；在 `native_trade_okx.rs` 补齐 `attachAlgoOrds`（下单附带 TP/SL）与 `order-algo` 条件止损单支持，并在 UI `OrderTicket.svelte` 显式展示当前合约的资金费率、强平价与保证金模式。
   - **验收标准**：使用 OKX 模拟盘 API Key 在 K 线图上带止损/止盈开 1 张 `BTC-USDT-SWAP` 多单，图表同时出现持仓线与止盈/止损挂单线，拖动止损线可在 OKX 模拟盘真实改价，一键平仓后自动撤销挂单。

3. **打通图表快速复盘 (`QuickPanel`) → 交易日志/正式回测，并优化回测交接超时**
   - **现象**：在 K 线图上用「快速回测」手工点完 20 笔模拟复盘交易后，数据锁死在浏览器偏好里，既不能一键导入交易日志做行为复盘，也不能把当前图上的指标组合带去 `/backtest`；且未提前下载的标的点击「回测」按钮常因下载超过 12 秒报错。
   - **根因**：`frontend/src/lib/modules/histviz/QuickPanel.svelte:269-294` 仅提供撤销/重置/关闭按钮，无导出接口，且时间硬编码 UTC（`QuickPanel.svelte:65`）；`frontend/src/lib/modules/histviz/Pane.svelte:1662-1700`（`toBacktest`）只传 `?dataset=${id}`，不带 `pane.instances` 指标参数，且轮询 `waitForStore()` 固定最多 `20 × 600ms = 12s`。
   - **具体改法**：① 在 `QuickPanel.svelte` 增加「导出到模拟日志本」按钮，将 `trades` 批量 POST 到 `/api/journal/trades`（归入指定复盘分类）；② `toBacktest()` 支持将当前面板已加载的 `pane.instances` 指标类型与周期序列化为草稿参数传给 `/backtest`，并将下载等待改为跳转后在回测页展示真实任务进度。
   - **验收标准**：在 K 线图上打开快速回测手工完成 2 笔模拟买卖并点击「存入复盘日志」，在 `/journal` 对应分类中立即可见这 2 笔交易；在图表添加 EMA20/EMA50 后点「去回测」，回测页自动选中该标的并预填 EMA20/EMA50 指标。

---

### 模块 4：历史数据 (`histdata`)

1. **内置 A 股自定义 HTTP/Push 数据源模板（解决 A 股历史与前复权缺口）**
   - **现象**：23 个内置连接器全无 A 股数据源，用户想拉取 A 股前复权日线/分钟线只能手写 JSON 映射规则，门槛极高。
   - **根因**：`core/connectors/providers/src/lib.rs:4-49` 无 A 股原生连接器；虽然底层已经做好了自定义 `http` 和 `push` 数据源引擎（`core/otw-core/src/histdata/kinds/mod.rs:32`），但前端没有提供开箱即用的 A 股模板（如对接自建 AKShare / Tushare / 东方财富 HTTP 代理）。
   - **具体改法**：在自定义源创建向导中内置 2 个预填模板（`AKShare 自托管 HTTP 模板` 与 `通用 A 股 Push 导入模板`），预设 `ts/o/h/l/c/v` 字段映射、交易所时区 `Asia/Shanghai`、以及 `600519.SH`/`000001.SZ` 代码规范提示；同时在仓库提供一份独立的 30 行 Python AKShare 适配器示例脚本（供用户单容器部署）。
   - **验收标准**：在「历史数据 → 连接器」一键选择「A 股自定义 HTTP 模板」，填入本地 AKShare 服务地址，点击测试连接通过后，成功下载 `600519.SH` 过去 5 年前复权日线并在 `/histviz` 正常出图。

2. **支持按自选列表批量下载与一键补齐多标的回测数据**
   - **现象**：要对自选里的 15 只美股或 OKX 主流永续币种做回测/扫描，只能在 `histdata` 里逐个手动搜索、建任务、点下载。
   - **根因**：`core/otw-core/src/histdata_api.rs` 仅支持单标的或手动勾选数据集的下载/刷新，未读取 `watchlists` 表提供「从自选批量创建数据集」入口。
   - **具体改法**：新增 `POST /api/histdata/jobs/from-watchlist` 接口（接收 `watchlist_id`、目标 `connector_id`、`timeframe`、`from/to`），自动解析自选列表内所有标的并批量排入 `histdata_jobs` 队列，跳过已覆盖区间。
   - **验收标准**：在 `histdata` 点击「从自选导入下载」，勾选一个含 5 个标的的自选列表与 `1h` 周期，自动生成 5 条下载任务且完成后在数据集列表全部就绪。

3. **为 OKX 永续数据集同步拉取并存储历史资金费率序列**
   - **现象**：OKX 永续合约历史 K 线已完整入库，但回测与图表完全看不到历史 8 小时资金费率波动，高费率行情下的多空持仓成本失真。
   - **根因**：`core/otw-store/src/data_admin.rs:94-97` 显示 `histdata` 仅存储 `histdata_bars`（OHLCV），`core/connectors/providers/src/okx/` 未拉取 OKX `/api/v5/public/funding-rate-history` 接口。
   - **具体改法**：新增 `histdata_funding_rates(dataset_id, ts, rate)` 轻量表（或挂在数据集附属元数据上），在 OKX 连接器下载 `perp` 数据集时可选勾选「同时同步历史资金费率」，供 `backtest` 引擎按真实历史时间点扣减/计收资金费率。
   - **验收标准**：下载 `BTC-USDT-SWAP` 过去 1 年 `1h` 数据并勾选资金费率后，数据库写入约 `1095` 条 8h 资金费率记录，且回测高级设置中可选「使用历史真实资金费率」。

---

### 模块 5：策略回测 (`backtest`)

1. **补齐 A 股真实交易规则模拟（T+1、涨跌停锁单、卖方单边印花税）**
   - **现象**：用现有引擎回测 A 股短线/波段策略结果严重偏乐观——当日买入信号若盘中触发止损会被立刻「当日卖出」（违反 T+1），一字涨停板会被「开盘价买进」，且无法分别设置双向佣金与单边卖出印花税。
   - **根因**：`core/otw-core/src/backtest/mod.rs:622-657` 仅支持 `lot_step`（可手填 100 股）和 `tick_size`，`frontend/src/lib/modules/backtest/steps/SizingStep.svelte:150-186` 仅支持对称费率 + `maker_fee`，引擎核心循环无 T+1 持仓冻结日检查、无涨跌停不可成交判定（`open == high == low` 或涨幅 ≥ 9.95%/19.95% 禁买/禁卖）。
   - **具体改法**：在 `Settings` 新增可选 `market_rules` 块（默认关闭，提供「A 股主板」「A 股科创/创业板」一键预设）：① `t_plus_one: true`（当日买入仓位次交易日才允许平仓/触发止损）；② `price_limit_pct: 10 | 20`（涨停买不进、跌停卖不出，顺延至开板）；③ `sell_tax_pct`（卖方单边印花税，如 `0.05%`）+ 最低佣金 `min_fee`（如 `5 元`）。
   - **验收标准**：在 A 股主板预设下回测 1 分钟/日线策略，当日买入后即便同日跌破止损线也不在当日成交、而是在次日开盘成交；一字涨停 K 线不产生买入成交；交易明细中卖出费用明显高于买入费用。

2. **将永续资金费率从「固定年化常数」升级为「历史费率 + 逐仓/全仓强平模拟」**
   - **现象**：回测 OKX 5x~20x 永续策略时，资金费率只能填一个固定年化数（如 `10.95%`），且高杠杆穿仓只按普通保证金拒单或浮亏算，缺少真实强平机制。
   - **根因**：`core/otw-core/src/backtest/mod.rs:710-725` 明确注明 `Funding` 只是恒定年化估算（`"A constant annualized rate... historical per-exchange series are a separate data project"`），且引擎无维持保证金率（MMR）触发强平逻辑（`AdvancedStep.svelte:269-299` 仅有日最大亏损与总回撤熔断）。
   - **具体改法**：① 接入模块 4 新增的 `histdata_funding_rates` 表，优先按每 8h 真实历史费率结算，无历史数据时退回固定年化估算；② 在 `SizingStep` 高杠杆（`leverage > 1`）时增加 `maintenance_margin_pct` 参数，当 K 线内极值触及强平价时以 `exit_reason = "liquidation"` 强制清仓并扣除强平费。
   - **验收标准**：对 `BTC-USDT-SWAP` 开启 10x 杠杆和 `0.5%` 维持保证金回测暴跌区间，K 线跌超 ~9.5% 时交易列表记录一次 `强平 (liquidation)` 离场，不再出现权益跌成负数的假象。

3. **支持「从自选列表选数据」、URL 深度打开策略，以及回测明细中文化**
   - **现象**：回测第 1 步只能从全部历史数据集里逐个翻找；从仪表盘「收藏策略」卡片点进回测页不会加载对应策略；回测成交明细的方向列仍显示英文 `long`/`short`。
   - **根因**：`frontend/src/routes/backtest/+page.svelte:966-1039` 仅解析 `?run=`、`?window=`、`?paper_session=`、`?dataset=`，**不支持 `?strategy=`**，导致 `BacktestWidget.svelte:154` 只能跳裸 `/backtest`；`frontend/src/lib/modules/backtest/TradesTable.svelte:115` 直接渲染 `{tr.direction}` 未走 `$t(...)`，且 `TradesTable.svelte:56-61` 时间格式化忽略 `tz.value`。
   - **具体改法**：① 在 `routes/backtest/+page.svelte` 消费 `?strategy=<id>` 自动调用 `openStrategy`，并同步更新 `BacktestWidget.svelte:154` 链接为 `/backtest?strategy=${s.id}`；② 在 `DataStep.svelte` 增加按自选组筛选/一键全选已下载数据集；③ 修复 `TradesTable.svelte:115` 用 `$t('journal.side.' + tr.direction)` 与统一时区格式化。
   - **验收标准**：点击仪表盘「收藏策略」中的任意策略直接打开该策略草稿；运行回测后「交易列表」方向列显示中文「做多/做空」，时间与全局设置时区一致。

---

### 模块 6：交易日志 (`journal`)

1. **补齐 `USDT`/`USDC` 稳定币计价支持与 OKX 90 天历史拉取断点续传**
   - **现象**：从 OKX 同步永续成交记录后，因 `USDT` 不在日志白名单币种内且前端 `Intl.NumberFormat` 不认识 `USDT`，金额显示丢掉币种单位，手续费换算频繁产生待处理 FX 任务；且只要有一笔持仓超过 90 天，后续定时同步全部报错中断。
   - **根因**：`frontend/src/lib/modules/journal/api.js:423-436`、`core/otw-store/src/journal_fx.rs:21-23` 和 `core/otw-core/src/fx.rs:46` 仅支持 12 种法币，不含 `USDT`/`USDC`；`frontend/src/lib/format.js:95-114`（`intlMoney`）对非 ISO 4217 代码 `USDT` 触发 `catch` 后直接丢弃货币符号；`core/otw-core/src/journal_import/broker.rs:545-551` 因 `resume_from` 锁死在未平仓位开仓日，超过 OKX 90 天历史窗口即被 `check_window` 拒绝。
   - **具体改法**：① 在 `journal::CURRENCIES` 与 `format.js` 的 `SYMBOLS` 表中加入 `USDT`/`USDC`（`fx` 层默认支持 `1 USDT = 1 USD` 可配置锚定，避免误报 `journal_fx_pending`）；② 在 `journal_import/broker.rs:530-551` 对超过交易所档案上限的长期未平仓位自动转化为只读 `Seed` 锚点并推进 `resume_from` 到窗口内，不再阻断新成交增量同步。
   - **验收标准**：同步 OKX 永续成交后，交易列表和盈亏曲线正确显示 `+120.50 USDT` 且零 `FX pending` 报错；模拟一笔 100 天前开仓的未平仓单，定时同步仍能正常拉取最近 7 天的新成交。

2. **为 CSV 导入增加 A 股中文券商词典，并修复交易列表硬编码英文与时区错位**
   - **现象**：A 股交易日志只能逐笔手录（无中文表头识别）；交易列表里「方向」列直接打印英文 `long`/`short`，且日期筛选和列表时间无视系统设置时区。
   - **根因**：`core/otw-core/src/import/dict.rs:60-200` 零中文列名；`frontend/src/lib/modules/journal/Trades.svelte:400` 硬写 `{tr.side}` 未走 `$t(...)`；`Trades.svelte:130-131` 和 `235-242` 使用浏览器本地时区 `toLocaleDateString()`/`toLocaleTimeString([])` 而非 `tz.value`。
   - **具体改法**：① 复用模块 1 补充的中文导入词典并增加「同花顺/东方财富/富途/雪球」常见列样例测试；② 将 `Trades.svelte:400` 改为 `{$t('journal.side.' + tr.side)}`；③ 列表时间与日期筛选统一使用 `$lib/tz.svelte.js` 的全局时区转换（24 小时制）。
   - **验收标准**：导入一份东方财富中文成交 CSV 自动识别所有核心列；日志列表方向列显示「做多/做空」，将全局时区从 `Asia/Shanghai` 切到 `America/New_York` 后，每笔交易的入场/出场时间同步切换且无 AM/PM。

3. **打通「日志 → 组合账本」单向同步，消除同一笔券商成交导两次的重复劳动**
   - **现象**：同步完 IBKR 或 OKX 成交到 `journal` 后，想看组合净值与资产配置还要再去 `portfolios` 点一次券商导入；在 `histviz` 图上下单虽然能通过 `journal_import::chart` 自动入日志（`journal_import/chart.rs:36-168`），但 `portfolios` 毫无变化。
   - **根因**：`core/otw-core/src/journal_import/broker.rs` 与 `core/otw-core/src/portfolios_import/broker.rs` 两套独立导入逻辑，各自写 `journal_trades` 和 `portfolio_operations`，无共享事件或联动开关。
   - **具体改法**：在 `journal` 的券商同步配置（以及 `histviz` 的 `journal-link`）增加可选「同时镜像写入指定投资组合」选项，新入账成交按 `external_id` 去重后自动生成对应 `portfolio_operations` 记录。
   - **验收标准**：开启镜像开关后，完成一次 IBKR 或 OKX 券商同步（或在图表下单一笔模拟单），同时在 `/journal` 看到交易记录并在 `/portfolios` 看到对应持仓数量与成本价更新，再次同步不产生重复记录。

---

### 模块 7：新闻资讯 (`news`)

1. **提供一键导入「美股 · A 股 · 加密」中文/双语优质 RSS/API 预设源包**
   - **现象**：首次打开新闻模块是全空的，新建源表单（`FeedForm.svelte`）没有任何预设，用户必须自己找 RSS URL 或手写 JSONPath 映射。
   - **根因**：`frontend/src/lib/modules/news/FeedForm.svelte:18-48` 与 `core/otw-core/src/feeds_api.rs` 仅提供空白表单，没有任何开箱即用的金融新闻源模板。
   - **具体改法**：在前端增加「从推荐模板添加」抽屉，内置 3 组可勾选预设看板：① **美股快讯**（Reuters/CNBC/SEC EDGAR Atom/华尔街见闻美股 RSS）；② **A 股与宏观**（财联社电报/东方财富快讯/巨潮公告 RSSHub 或公开 JSON API 映射模板）；③ **加密与 OKX**（CoinDesk/The Block/吴说/OKX 官方公告 API 映射模板）。
   - **验收标准**：新实例进入 `/news`，点击「一键初始化三市场资讯源」，勾选 3 组模板后 10 秒内自动拉取并展示美股、A 股、加密实时快讯流。

2. **增加标的自动识别与回链（从新闻一键跳图表/自选）**
   - **现象**：新闻条目只有纯标题、来源和外部链接（`routes/news/+page.svelte`、`NewsWidget.svelte:59-77`），看到某条突发行情新闻无法直接点开对应 K 线图，且自选点击新闻角标会直接覆写用户原有的新闻搜索词。
   - **根因**：`core/otw-core/src/feeds_api.rs` 入库 `feed_items` 时不做 ticker/公司名提取；`WatchlistDetail.svelte:179-184` 通过改写持久化偏好 `otw.news.prefs.v1` 来传参 `q: item.symbol`，会破坏用户保存的新闻筛选条件。
   - **具体改法**：① 在新闻入库或渲染时对照 `watchlists` + `portfolios` 持仓标的（含中文别名）高亮匹配到的标的徽章，点击徽章直接跳转 `/histviz?provider=...&ticker=...&tf=15m`；② `/news` 支持读取 URL 参数 `?q=...` 临时过滤而不覆盖用户的持久化偏好，改写 `WatchlistDetail.svelte:179-184` 为 `goto('/news?q=...')`。
   - **验收标准**：当新闻标题出现已关注标的（如 `NVDA` 或 `贵州茅台`）时自动带可点击标的标签，点击直达对应 K 线图；从自选点进某标的新闻后再刷新 `/news` 首页，原来的筛选条件未被破坏。

3. **统一 `NewsWidget` 时区/中文日期格式，并支持按资讯看板过滤小组件**
   - **现象**：新闻主页面（`routes/news/+page.svelte:468-481`）遵守了 `default_timezone`，但仪表盘上的 `NewsWidget` 时间仍按浏览器默认格式渲染，且只能选「单个源」或「全部」，不能选「某个新闻看板（如“美股快讯”或“OKX 公告”）」。
   - **根因**：`frontend/src/lib/modules/dashboard/widgets/NewsWidget.svelte:10-15` 自己写了个裸 `d.toLocaleString(undefined, ...)`，既没读 `tz.value` 也没用 `$locale`；`NewsWidget.svelte:39-40` 只传了 `feed_id`，没利用 `newsApi.listItems` 已支持的 `dashboard_id`（`routes/news/+page.svelte:237`）。
   - **具体改法**：让 `NewsWidget.svelte` 改用统一的 `fmtDateTime(s, tz.value)`，并在小组件配置项加入 `dashboard_id` 下拉选择（优先级高于单源）。
   - **验收标准**：在仪表盘添加 2 个新闻小组件，分别绑定「美股快讯」和「加密快讯」看板，两者显示各自看板的聚合流且时间严格匹配系统时区与中文 24 小时制。

---

### 模块 8：仪表盘 (`dashboard`)

1. **新增「实盘券商实时持仓与资金」小组件（打通真正的实盘持仓看板）**
   - **现象**：用户最想要「实盘持仓看板」，但整个仪表盘 30+ 小组件里**没有任何一个能读取券商实时持仓与保证金**！实盘持仓目前被锁死在 `/histviz` 图表页底部抽屉里（`BrokerTabs.svelte`），首页仪表盘只能看手工/异步导入的静态 `portfolios` 或 `journal` 记录。
   - **根因**：`frontend/src/lib/modules/dashboard/widgets/registry.js:25-577` 没有注册任何基于 `brokersApi.book`/`brokersApi.account`/`brokersApi.marks` 的小组件；实盘轮询与 SSE（`/api/brokers/events`）全写在 `frontend/src/routes/histviz/+page.svelte:646-808` 内部未抽成复用层。
   - **具体改法**：将 `brokersApi.book` + `brokersApi.account` + `brokersApi.marks` 封装为共享 store，在 `widgets/registry.js` 新增 `type: 'broker-book'` 小组件（含 `positions` 实时持仓/未实现盈亏/杠杆/强平价、`account` 总权益/可用保证金、`orders` 当前委托 3 个变体），支持多券商（IBKR + OKX）合并或分账展示。
   - **验收标准**：在首页仪表盘拖入「实盘持仓」和「券商资金」卡片，打开首页即可 1~4 秒级实时看到 OKX 永续多空仓位、杠杆、浮动盈亏以及 IBKR 美股持仓，点击任意持仓行直接跳转到 `/histviz` 对应标的图表。

2. **修复小组件跳转丢参、CNY 组合强标 `$` 以及加密货币数量截断为 `0` 的 Bug**
   - **现象**：① 在仪表盘「日志持仓」卡片里持有 `0.05 BTC` 显示数量为 `0`；② `CNY` 组合在仪表盘资产配置环形图中心和组合对比条形图里被强行标成 `$`；③ 点击仪表盘的「图表工作区」或「策略收藏」条目只打开默认页，不进入点中的那个工作区/策略。
   - **根因**：① `frontend/src/lib/modules/dashboard/widgets/JournalStatsWidget.svelte:303,337` 硬传小数位 `0`（`fmtNum(p.open_qty, 0)`、`fmtNum(p.qty, 0)`）；② `PortfolioWidget.svelte:111,243` 调用了硬编码 USD 的 `fmtCompactMoney`（`format.js:161-169`）而不是传了币种的 `fmtCompactValue(v, ccy)`；③ `HistvizWidget.svelte:104,119` 写死 `href="/histviz"`，`BacktestWidget.svelte:154` 写死 `href="/backtest"`。
   - **具体改法**：① `JournalStatsWidget.svelte:303,337` 改为自适应小数位（如 `Math.abs(n) < 1 ? 4 : 2` 或复用 `Trades.svelte:259` 的去尾零逻辑）；② `PortfolioWidget.svelte:111,243` 替换为 `fmtCompactValue(v, ccy)`；③ 为 `HistvizWidget` 和 `BacktestWidget` 补齐 `?workspace=<id>`、`?list=<id>`、`?strategy=<id>` 深度链接并在目标页消费。
   - **验收标准**：日志持仓卡片中 `0.05 BTC` 显示 `0.05` 而非 `0`；人民币组合环形图中心显示 `¥xx万`（或 `¥xxK`）而非 `$`；点击仪表盘任意图表工作区或收藏策略准确打开对应项。

3. **提供一套面向「三市场单人交易员」的默认中文看板预设，清理默认噪音页**
   - **现象**：首次打开首页默认塞了 6 个预设工作区（Investor/Trader/Quant/Portfolio/Utilities/Scanner），里面混着大量用不上的模块卡片（`mportfolios`、`economics` 英文 iframe、`routines`、`mindset`、`subscriptions`、`goals`、`mailbox` 等），需要手动删半天。
   - **根因**：`frontend/src/lib/modules/dashboard/layout.js:49-106,217-343` 默认初始化全部 6 个大而全预设且强绑未精简的 34 模块体系。
   - **具体改法**：在 `layout.js` 新增单人精简预设（或自动过滤未启用模块并重排空洞），开箱即呈现「实盘持仓 + 自选报价 + 盈亏/净值曲线 + 新闻快讯 + 图表/回测快捷入口」一屏闭环布局（具体排布见第 6 节）。
   - **验收标准**：新用户只启用第 6 节的 8 个模块时，首页零「模块未安装/空卡片」占位，一屏内完整呈现持仓、行情、盈亏、新闻与研究入口。

---

## 3. 数据联动检查：`自选 → 图表 → 回测 → 交易日志 → 仪表盘`

### 3.1 链路逐段核查（通 / 断 / 精确位置）

```
[自选 watchlists] ──(1)──▶ [图表 histviz] ──(2)──▶ [回测 backtest] ──(3)──▶ [交易日志 journal] ──(4)──▶ [仪表盘 dashboard]
       │                         │                                                 ▲                          ▲
       ├──(5)──▶ [新闻 news]      └──(6) 实盘下单自动记日志 ──────────────────────────┘                          │
       └──(7)──▶ [组合 portfolios] ◄────────(8) 断开：与日志/图表实时持仓完全割裂 ────────────────────────────────┘
```

1. **链路 (1) 自选 → 图表：`半通（美股通，加密/OKX 断）`**
   - **已通部分**：`frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:186-191,938-941` 构造 `/histviz?provider=...&asset_type=...&ticker=...&tf=1d`，`frontend/src/routes/histviz/+page.svelte:1202-1224` 正常解析并在当前窗格打开；此外图表的 `WatchRail.svelte:5-14` 也能只读浏览自选列表。
   - **断点位置**：
     - `core/otw-core/src/watchlists/quotes.rs:389` 对默认用 CoinGecko 添加的加密货币返回 `chart_coords = None`，导致 `WatchlistDetail.svelte:943` 按钮直接灰显禁用（所有默认加密自选点不开图表）。
     - `core/otw-core/src/watchlists_api.rs:377-382` 与 `watchlists/quotes.rs:697-712` 不支持直接搜 OKX 永续且漏了 `okx` 默认代码拼装，导致 OKX 永续根本进不了标准自选→图表流。
     - `core/otw-core/src/histviz_api.rs:550-554` 反向从图表列表「提升到自选 (`promoteList`)」时会丢弃非 `stock/etf/crypto` 资产（如期货/永续）。

2. **链路 (2) 图表 → 回测：`半通（单标的裸数据集通，指标与快速回测全断）`**
   - **已通部分**：`frontend/src/lib/modules/histviz/Pane.svelte:1683-1700,2607-2617` 有「去回测」按钮，若已有 `histdata` 数据集则直接跳 `/backtest?dataset=${id}`，`frontend/src/routes/backtest/+page.svelte:1030-1039` 正常选中该数据集。
   - **断点位置**：
     - **不带指标**：`Pane.svelte:1694` 只传 `dataset` ID，用户在图表上调好的指标/参数（`pane.instances`）全部丢失。
     - **未下载标的易超时**：`Pane.svelte:1662-1692` 触发后台下载后仅固定轮询 `20 × 600ms = 12s`，拉长历史或限速源直接报 `backtestSaveFailed`。
     - **快速回测死胡同**：`frontend/src/lib/modules/histviz/QuickPanel.svelte:269-294` 手工点出的复盘成交无任何按钮可导出到 `/backtest` 或 `/journal`。
     - **回测不能选回自选**：`frontend/src/routes/backtest/+page.svelte:328-330` 只读 `histdata` 已下载列表，不能按自选股分组一键回测；且回测完成后没有「在完整图表页打开」的反向链接（仅内嵌了简化版 `Chart.svelte:1344`）。

3. **链路 (3) 回测 → 交易日志：`完全断开`**
   - **现状与断点**：`frontend/src/routes/backtest/+page.svelte:1273-1320` 的结果动作栏只有「参数优化」「转机器人 (`robots`)」「洞察 (`InsightsButton`)」「导出报告」「收藏结果」，**没有任何通往 `/journal` 的入口**（既不能把策略定义同步成 `journal_strategies` 避免两边各建一遍策略库，也不能把实盘日志里同名策略的表现与回测结果做实盘偏差对比）。
   - **证据**：`backtest` 策略存于 `backtest_strategies`，而 `journal` 策略独立存于 `journal_strategies`（`core/otw-store/src/data_admin.rs:39`），两张表无外键关联，策略名必须手动双边维护。

4. **链路 (6) 图表实盘下单 → 交易日志：`部分打通（但绕开了 portfolios）`**
   - **已通部分**：`frontend/src/lib/modules/histviz/OrderTicket.svelte:484-527` + `core/otw-core/src/histviz_api.rs:69,93-127` + `core/otw-core/src/journal_import/chart.rs:36-168` 实现了「图表标的绑定日志本 → 后台对账周期自动将成交归入该日志本」。
   - **断点位置**：
     - 仅对 `connector.chart_fills() == true` 且在历史拉取窗口内的券商有效（`journal_import/chart.rs:37,115`），A 股无券商完全无效；OKX 若持仓超 90 天触发 `check_window` 失败。
     - **不写入 `portfolios`**：自动记账只写 `journal_trades`，不更新 `portfolio_operations`，导致持仓看板与日志不同步。

5. **链路 (4)(7)(8) 日志 / 组合 / 实盘仓位 → 仪表盘：`结构性割裂`**
   - **实盘仓位断在仪表盘门口**：实盘实时持仓/委托/资金只在 `frontend/src/routes/histviz/+page.svelte:646-808` 与 `BrokerTabs.svelte` 内部消费，**仪表盘没有任何券商实盘小组件**（`widgets/registry.js:25-577` 零 broker 卡片）。
   - **组合与日志重复割裂**：同一笔 IBKR / OKX 交易必须分别在 `journal`（`POST /api/journal/import/broker/commit`，`journal_import_api.rs:52`）和 `portfolios`（`POST /api/portfolios/{id}/import/broker`，`portfolios_import/broker.rs`）导入两次；自选页的「提升到组合 (`PromoteModal.svelte`)」只推向 `portfolios`，不联动 `journal`。
   - **仪表盘跳转丢失上下文**：`HistvizWidget.svelte:104,119` 写死 `href="/histviz"`、`BacktestWidget.svelte:154` 写死 `href="/backtest"`，无法从仪表盘一键直达具体工作区或策略。

6. **链路 (5) 自选 ↔ 新闻：`半通（英文通，中文断且污染偏好）`**
   - `WatchlistDetail.svelte:179-184` 通过改写 `otw.news.prefs.v1` 跳 `/news`，会覆盖用户保存的筛选器；后端匹配正则 `\m...\M`（`otw-store/src/watchlists.rs:583-602`）在中文无空格新闻标题上几乎全军覆没。

### 3.2 重复实现清单（同一份数据两套以上取法）

| 重复数据 | 实现 A (`file:line`) | 实现 B (`file:line`) | 引发的问题 |
|---|---|---|---|
| **Yahoo / CoinGecko 现货行情** | `core/otw-core/src/portfolios/prices.rs:218-274`（拉 Yahoo v8 chart 并通过 `journal_fx` 折算成 USD） | `core/otw-core/src/watchlists/quotes.rs:52-97`（独立再拉一次 Yahoo v8 chart，且**不折算汇率**直接塞进 `price_usd`） | 同样代码请求两遍外部 API，且同只 A 股在组合里是折算价、在自选里是原币种错标 `$` |
| **交易所实时现价** | `core/otw-core/src/portfolios/prices.rs:282-314`（裸写 HTTP 调 Binance/Kraken/Coinbase 公共 ticker 接口） | `core/connectors/providers/src/`（23 个正规连接器，含 OKX/IBKR/Binance 等完整限流与认证） | `portfolios` 无法复用用户已配好的 OKX 或自定义 A 股连接器，多维护一套残缺 HTTP 抓取 |
| **自选列表** | `watchlists` 模块（`watchlists` + `watchlist_items` 表，`watchlists_api.rs`） | `histviz` 图表自有列表（`histviz_lists` 表，`histviz_api.rs:437-587`、`WatchRail.svelte:5-14`） | 两套列表互相半隔离：图表侧栏看 `watchlists` 为只读，图表列表升格到 `watchlists` 又丢永续/期货 |
| **券商账户成交同步** | `core/otw-core/src/journal_import/broker.rs`（写入 `journal_trades`） | `core/otw-core/src/portfolios_import/broker.rs`（写入 `portfolio_operations`） | 同一个 IBKR/OKX 账户必须配两次同步、存两份账本，且两者对空单处理逻辑完全相反 |
| **策略库** | `backtest` 策略库（`backtest_strategies` 表，`routes/backtest/+page.svelte`） | `journal` 策略库（`journal_strategies` 表，`journal_api.rs:254-290`） | 回测跑通的策略在日志复盘里要重录一遍名字，无法自动做「回测预期 vs 实盘执行」归因 |
| **时间与金额格式化** | 公共库 `frontend/src/lib/format.js` + `frontend/src/lib/tz.svelte.js` | 各模块自写 `fmtDate`/`fmtTs`/`fmtCap`/`fmtQuote`（`Trades.svelte:235`、`TradesTable.svelte:56`、`NewsWidget.svelte:10`、`BrokerTabs.svelte:344`、`QuickPanel.svelte:63`、`views.js:76`） | 时区、语言、币种符号、24 小时制全站不统一（详见第 4 节） |

---

## 4. 移动端与中文适配审计

> 背景：`ZH_FIX.md` 显示 `zh.json` 已完成 12,164 个 key 翻译（仍有 4 处占位符不匹配残留，`ZH_FIX.md:50`），但**代码层面的本地化、数字/币种/时区格式化与窄屏表格仍有明显“洋味”与错位**。

### 4.1 列宽与中文字符溢出 / 截断
1. **图表底部持仓表按 `ch` 估算宽度，中文直接少算一半**：`frontend/src/lib/modules/histviz/BrokerTabs.svelte:364-400,729-735` 使用 `table-layout: fixed` 并设 `<col style:width="calc({n}ch + 2 * var(--space-2))" />`，其中 `n` 取 `String(v).length + 2`。CSS 中 `1ch` 是拉丁数字 `0` 的宽度，而 1 个汉字约占 `2ch`，导致中文表头（如「未实现盈亏」「开仓时间」）和中文券商账户名被强行压窄截断或横向粘连。
2. **自选名称区窄宽限制 + 徽章挤压**：`frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:1426` 将次级行 `.subtle` 限制在 `max-width: 220px`，当 A 股中文全称 + 交易所 + 连接器标签并排时，公司名很快被截成 3~4 个字。
3. **加密货币小数持仓在仪表盘被截成整数 `0`**：`frontend/src/lib/modules/dashboard/widgets/JournalStatsWidget.svelte:303,337` 调用 `fmtNum(p.open_qty, 0)` 和 `fmtNum(p.qty, 0)`，小数位硬写为 `0`，持有 `0.15 BTC` 或 `0.4 ETH` 在首页看板直接显示 `0`。

### 4.2 窄屏 / 移动端体验别扭点
1. **回测交易明细表 15 列无移动端卡片降级**：`PortfolioDetail.svelte:1484-1564`、`WatchlistDetail.svelte:1743-1925`、`Trades.svelte:616-679` 均做了 `@media (max-width: 767px)` 卡片化重构，但 `frontend/src/lib/modules/backtest/TradesTable.svelte:78-131,235-254` 是 15 列 `white-space: nowrap` 宽表，窄屏下只能左右拖拽，且无首列固定（sticky）。
2. **图表快速回测栏在手机端“悄悄藏掉右侧控件”**：`frontend/src/lib/modules/histviz/QuickPanel.svelte:389-405` 设了单行固定高度 `height: 38px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;`，手机窄屏上右侧的「手数输入、单位下拉、撤销、重置」全部滚出视口且隐藏了滚动条，用户根本不知道还能左滑。
3. **K 线图移动端画线与工具栏过重**：`frontend/src/routes/histviz/+page.svelte:3664-3693` 在 `≤767px` 时将 `.top` 工具栏全部 `flex-wrap: wrap` 折成 3~4 行高（每按钮 `min-height: 44px`），且 `BrokerTabs` 与 `OrderTicket` 叠在图表下方占满屏幕（`max-height: 70%`），手机上单手查持仓+看 K 线需要频繁上下滚屏；此外 `NewsWidget` 的卡片网格最小列宽 `150px`（`NewsWidget.svelte:100`）在 375px 手机上会挤出两列极窄标题卡片，每行只能塞 6~7 个汉字。

### 4.3 硬编码英文单位、枚举与组件语言
1. **图表 X 轴与十字光标全英文**：`frontend/src/lib/modules/histviz/timeAxis.js:20-21,105-108,129-130` 写死 `MONTHS = ['Jan'..'Dec']` 与 `DAYS = ['Sun'..'Sat']`，中文界面下 K 线轴仍满屏 `Mon 27 Oct '26`。
2. **大数单位全硬编码英文 `T/B/M/K`，无中文「万/亿」**：`frontend/src/lib/format.js:161-190`（`fmtCompactMoney`/`fmtCompactValue`）与 `frontend/src/lib/modules/watchlists/views.js:76-99,184-192`（`fmtBig`/`fmtCap`/`shortPrice`）全写死 `T/B/M/K` 且多个函数直接拼死 `$` 符号（`PortfolioWidget.svelte:111,243` 在 CNY 组合下仍调用 `fmtCompactMoney` 吐出 `$`）。
3. **表格枚举与内联标签漏走 i18n**：
   - `frontend/src/lib/modules/journal/Trades.svelte:400` 直接输出 `{tr.side}`（显示 `long`/`short`）。
   - `frontend/src/lib/modules/backtest/TradesTable.svelte:115` 直接输出 `{tr.direction}`（显示 `long`/`short`）。
   - `frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:829` 内联硬写 `· crypto`。
   - `frontend/src/lib/modules/economics/EconomicCalendar.svelte:26` 硬写 `locale: 'en'`。
   - `ZH_FIX.md:50` 记录 `zh.json` 尚存 4 处占位符不匹配（需顺手清零以防运行时插值变量原样露出）。

### 4.4 日期格式与 12/24 小时制割裂
1. **全局公共格式化函数未指定 24 小时制**：`frontend/src/lib/format.js:298-309,330-335`（`fmtDateTime`/`fmtTime`）未传 `hourCycle: 'h23'`，在中文环境 `zh-CN` 下会输出 `2026年10月27日 下午9:57`（偏长且易换行），与金融软件常用的 `2026-10-27 21:57` 格格不入。
2. **大量页面绕过公共库裸调浏览器 `toLocale*`**：
   - `frontend/src/lib/modules/journal/Trades.svelte:239-241`：`d.toLocaleDateString()` + `d.toLocaleTimeString([], ...)`。
   - `frontend/src/lib/modules/backtest/TradesTable.svelte:60`：`d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })`。
   - `frontend/src/lib/modules/histviz/BrokerTabs.svelte:344-355`：`toLocaleTimeString()` / `toLocaleString([])`。
   - `frontend/src/lib/modules/histviz/OrderTicket.svelte:108`、`frontend/src/routes/histviz/+page.svelte:524`、`frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:842`、`frontend/src/lib/modules/dashboard/widgets/NewsWidget.svelte:14` 均裸调 `toLocale*`，不受应用内语言切换控制。

### 4.5 金额千分位、币种与「红涨绿跌」习惯
1. **千分位正常，但稳定币 `USDT`/`USDC` 崩溃丢单位**：`frontend/src/lib/format.js:95-114` 通过 `Intl.NumberFormat` 处理千分位，但 `USDT`/`USDC` 不属于 ISO 4217，`Intl` 抛异常后 `catch` 分支直接返回纯数字、**把 `USDT` 单位吞掉**。
2. **A 股「红涨绿跌」全站不支持**：全站涨跌色在主题与各模块样式中硬编码为**绿涨红跌**（`frontend/src/lib/theme/chart.svelte.js:77-78`、`PortfolioDetail.svelte:1373-1378`、`Trades.svelte:578-593`、`StatsGrid.svelte:125-130`、`QuickPanel.svelte:474-479`）。仅 K 线图本身允许用户在图表设置里手动改蜡烛颜色（`histviz/settings.js:68-69`），但自选涨跌幅、持仓盈亏、交易日志和仪表盘无法一键切换「红涨绿跌」。

### 4.6 时区严重不统一（最隐蔽的坑）
1. **后端默认配置仍为美式/UTC**：`core/otw-core/src/settings_api.rs:490-492` 默认值 `default_currency = "USD"`、`default_timezone = "UTC"`、`locale = "en"`，部署后必须第一时间在设置里改成 `Asia/Shanghai` + `zh`。
2. **改了 `default_timezone` 以后，大部分模块根本不认**：
   - `frontend/src/lib/format.js:290-343` 全部 6 个日期时间函数（`fmtDate`/`fmtDateTime`/`fmtDay`/`fmtMonthName`/`fmtTime`/`fmtMonth`）**从未传入 `timeZone: tz.value`**，永远按浏览器本机时区渲染。
   - `frontend/src/lib/modules/histviz/QuickPanel.svelte:65` 直接用 `d.toISOString().slice(0, 16)`——**强行显示 UTC**，北京时间直接差 8 小时。
   - `frontend/src/lib/modules/watchlists/WatchlistDetail.svelte:506` 日报摘要时间硬写死 `UTC`（`${hour}:00 UTC`）。
   - `frontend/src/lib/modules/journal/Trades.svelte:130-131` 日期筛选用浏览器本地 `new Date(fSince + 'T00:00:00').toISOString()`，与 `histviz`（读 `tz.value`）和 `news`（`routes/news/+page.svelte:474` 读 `default_timezone`）在跨时区（例如用美东时区看美股夜盘）时会出现「图表在今天、日志算昨天」的跨日错位。

---

## 5. 「框架好看但我用不上」的模块清单与维护成本账单

除核心 8 个模块（及美股深研可选的 `fundamentals`、盘中选股可选的 `scanner`）外，以下 **24 个模块**在单人自托管、专注「美股·A股·OKX永续 + 实盘/行情/回测/日志/新闻」的场景下属于冗余资产。

> 说明：在架构上，OpenTraderWorld 的 `installed.js`（`frontend/src/lib/modules/installed.js`）允许在界面里「卸载/隐藏」模块（不删源码即可减少 UI 噪音），但**后端后台轮询任务（`core/otw-core/src/main.rs:463-736`）和数据库表迁移仍会无条件启动和存在**；若彻底停用/裁剪对应模块及后台循环，可实质降低资源占用与长期升级维护负担。

| 分组 | 模块名 (`id`) | 为什么对你没用（结合用户背景） | 对应 DB 表 (`data_admin.rs`) | 常驻后台循环 (`main.rs`) | 前端/后端维护面说明 |
|---|---|---|---|---|---|
| **一、空壳/不可实盘** | `economics` | 82 行 TradingView 英文 iframe 壳，不可过滤中文事件、无本地数据（`EconomicCalendar.svelte:21-31`） | 0 张（`data_admin.rs:226`） | 无 | 省去第三方嵌入失效与主题割裂排查 |
| | `robots` | 实时流模式被硬拒（`robots/api.rs:142-148`），OKX 执行层未验证、IBKR 仅纸面，不能用于真钱自动交易 | **9 张**（`data_admin.rs:101-115`） | **3 个**（`main.rs:729-731`：`job`/`live`/`exec`） | 砍掉可省最大一块高危实盘状态机维护（9 表 + 3 后台任务） |
| **二、地域/品类错配** | `taxcalc` | 仅支持美欧澳 9 国税制（`taxcalc.rs:23-64`），对中国大陆/香港税务居民完全无用 | 3 张（`data_admin.rs:153-156`） | 无 | 省去多国税法适配代码与 2 套 API 路由（`main.rs:707-708`） |
| | `options` | 仅支持美股/ETF/指数且限 `massive/ibkr/alpaca`（`options_api.rs:46,142-152`），不支持 OKX 加密期权与 A 股期权，且不在需求内 | 1 张（`data_admin.rs:146`） | 无 | 省去独立期权链拉取任务与 Greeks 计算页面 |
| | `mportfolios` | 只爬 Dataroma 美股 13F（滞后 45 天，`mportfolios_api.rs:3-6`），不覆盖 A 股/加密，实盘参考价值低 | 2 张（`data_admin.rs:116-120`） | **1 个**（`main.rs:487` 定时爬虫） | 省去易因 Dataroma 改版而报错的定时网页抓取任务 |
| | `community-docs` | 硬编码英文官网文档流（`community_docs_api.rs:30,39`），中文环境几乎无阅读价值 | 1 张（`data_admin.rs:164`） | 无 | 省去官网外链中继与限流器状态（`main.rs:332`） |
| **三、与核心重叠/过重** | `quant` | 单标的/组合风险、相关性、季节性，与 `backtest` 统计和 `watchlists` 相关性视图大量重叠，除非专职多因子研究 | 0 张（`data_admin.rs:227`） | 无（占用 `compute_gate`，`main.rs:693-695`） | 省去 2 套后端计算路由与独立可视化维护 |
| | `findb` | 离线静态全球代码表（无实时行情、无 OKX 永续），日常找标的有连接器搜索与自选足够 | 2 张用户表 + 静态参考库（`data_admin.rs:86-91`） | 无 | 省去静态大表导入与陈旧代码清理 |
| | `automator` | 站内低代码工作流编排引擎（6 表 + 版本化），单人自托管配置调试成本高于写 10 行脚本 | **6 张**（`data_admin.rs:195-206`） | **1 个**（`main.rs:727` 调度器） | 砍掉省去极重的 DAG 编排器与 6 表运维 |
| | `agent` | 内置通用 AI 聊天+记忆+技能框架，需自备 API Key 维护提示词，且非核心交易闭环刚需 | **6 张**（`data_admin.rs:183-194`） | **1 个**（`main.rs:603` 外部控制桥 + 启动种子 `main.rs:421`） | 砍掉省去 6 表 + MCP 令牌/多模型适配维护（日后需要研报摘要再单独按需启用） |
| | `prompt-store` | AI 提示词库，砍掉 `agent` 后无使用场景 | 2 张（`data_admin.rs:158-163`） | 无 | 省去独立版本库维护 |
| | `webhooks` | `registry.js:249` 明示 v1 只能转发到 `remindme` 通知，不能驱动下单或写日志 | 2 张（`data_admin.rs:178-182`） | 无（暴露公网免鉴权入口 `main.rs:624-629`） | 砍掉还能**直接缩减一个公网无 Cookie 攻击面** |
| **四、个人生活/效率杂项** | `editor` | 通用 Notion 替代品（文档+内嵌数据库），单人交易者通常已有 Obsidian/Notion/飞书，交易笔记写在 `journal`/`portfolios` 备注即可 | 4 张（`data_admin.rs:23-27`） | 无 | 省去富文本编辑器、文档版本与附件管理维护（注：需保留 `files-api` 供 `journal` 传截图，`TradeForm.svelte:20`） |
| | `mailbox` | 只读 IMAP 收信客户端，完全与交易工作台主线无关 | **5 张**（`data_admin.rs:166-177`） | **1 个**（`main.rs:558` 定时 IMAP 轮询） | 省去 5 张表 + 持久 IMAP 连接内存/凭据管理 |
| | `wealth` | 房产/车贷/银行卡净值表，与 `portfolios` 数据隔离，偏个人家庭理财 | 4 张（`data_admin.rs:58-67`） | **1 个**（`main.rs:546` 贷款/估值循环） | 省去 4 表 + 定时循环 |
| | `subscriptions` | SaaS 会员订阅记账本，与交易无关 | 2 张（`data_admin.rs:48-52`） | **1 个**（`main.rs:550` 小时级续费检查） | 省去 2 表 + 定时循环 |
| | `time` | 自由职业工时计费计时器，与交易无关 | 3 张（`data_admin.rs:53-57`） | 无 | 省去 3 表与独立前端 |
| | `goals` | 通用个人目标进度条，与交易无关 | 1 张（`data_admin.rs:68`） | 无 | 省去冗余导航与小组件 |
| | `todos` | 通用待办清单，与交易无关 | 1 张（`data_admin.rs:69`） | 无 | 省去冗余导航与小组件 |
| | `calendar` | 只聚合 `todos`/`goals`/`remindme`，不聚合财报/交割/交易日志 | 1 张（`data_admin.rs:92`） | 无 | 省去空转日历页 |
| | `routines` | 盘前打卡清单，轻度用户很少坚持手点 | 4 张（`data_admin.rs:70-79`） | 无 | 省去 4 表维护 |
| | `mindset` | 交易情绪问卷，功能完全可被 `journal` 的纪律标签 (`tags`) 覆盖 | 2 张（`data_admin.rs:80-84`） | 无 | 省去 2 表与重复复盘入口 |
| | `remindme` | 通用备忘录提醒页面（交易价格/K线告警由 `watchlists`/`histviz` 独立触发并直接走 `notif_channels_api`） | 2 张（`data_admin.rs:85`） | **1 个**（`main.rs:542` 分钟级轮询） | 省去独立提醒页与分钟级轮询（若仅做前端隐藏则保留后台） |
| | `resources` | 网址书签管理器，浏览器书签足够 | 2 张（`data_admin.rs:157`） | 无 | 省去 2 表与网页元数据抓取 |

**合计可省维护成本（硬指标汇总）**：
- 隐藏/裁剪上述 24 个模块后，系统模块数从 **34 → 8~10**（削减 **71%+** 侧栏与导航噪音）；
- 减少 **65 张数据库表**（`data_admin.rs` 全库可管理业务表共 109 张，占 **~60%**）；
- 停用 **10 个常驻后台 Tokio 轮询循环**（`robots×3`、`mportfolios`、`automator`、`control/agent`、`mailbox`、`wealth`、`subscriptions`、`remindme`），显著降低单人自托管 VPS 的空闲 CPU/内存、数据库连接与外部告警噪音；
- 移除公网免 Cookie Webhook 接收端点（`/api/hooks/{token}`，`main.rs:624-629`），收窄安全暴露面。

*(注：`fundamentals` 与 `scanner` 不在上述砍掉清单里，归类为「按需开启的选装第 9、第 10 模块」——美股财报/SEC 深度研究时开 `fundamentals`，多标的指标选股时开 `scanner`。)*

---

## 6. 给你的「最小可用工作台」建议

### 6.1 模块选型（严格 8 个，满足硬依赖）

1. **`dashboard`**（仪表盘）：总控台入口，一屏看清持仓、自选、盈亏、新闻。
2. **`portfolios`**（投资组合追踪）：全市场资产账本（美股 + A 股 + 加密现货/永续），承担净值曲线、仓位占比与组合复盘。
3. **`watchlists`**（自选股）：三市场统一自选报价、分组管理、涨跌幅与价格预警。
4. **`histdata`**（历史数据）：`histviz` 与 `backtest` 的硬依赖底座（`registry.js:149,158`），负责管理 IBKR/OKX/Yahoo 与自建 A 股 HTTP 数据源。
5. **`histviz`**（K 线图表）：核心看盘、画线、实时 WS 报价、以及（补强前）查看 OKX/IBKR 实时仓位与图上交易的唯一工作区。
6. **`backtest`**（策略回测）：策略编写、历史验证、参数优化与逐笔复盘。
7. **`journal`**（交易日志）：实盘成交自动同步、多腿复盘、盈亏日历与纪律标签统计。
8. **`news`**（新闻资讯）：三市场定制 RSS/API 快讯聚合流。

> **为什么正好 8 个、不多不少**：用户明确要求 5 大能力——实盘持仓看板（`dashboard` + `portfolios`）、行情（`watchlists` + `histviz` + 硬依赖 `histdata`）、回测（`backtest`）、交易日志（`journal`）、新闻研究（`news`），刚好一一对应且满足 `registry.js` 依赖约束。若后续需要看美股 10-K/Form 4 内部人交易，再把 `fundamentals` 当作第 9 个选装打开即可。

### 6.2 推荐仪表盘布局（基于 12 列网格 `COLS = 12`，`dashboard/layout.js:36`）

设计原则：**左重仓位与盈亏、右重行情与异动、底部承接研究与复盘**；单页 4 行、共 9 张卡片，均直接对应 `dashboard/widgets/registry.js` 已注册的 `type` + `variant`（外加 1 处标明补强后可平滑替换的「实盘持仓」升级位）：

```text
+---------------------------------------------------------------------------------------------------+
| 第 1 行（高 220px standard）：总览核心 KPI（左看钱，右看行情脉冲）                                    |
| [ portfolios · evolution (span: 6) ]  [ portfolios · allocation (span: 3) ] [ journal-stats · pnl (span: 3) ]
|   全账户净值曲线 (1M/3M/1Y)             美股/A股/加密/现金 配置占比             近期交易已实现盈亏 + 迷你曲线 |
+---------------------------------------------------------------------------------------------------+
| 第 2 行（高 340px tall）：实盘持仓 + 核心自选报价（每天盯盘主视野）                                    |
| [ portfolios · positions (span: 7) ]                                [ watchlists · quotes (span: 5) ]
|   当前持仓明细表（补强后替换为新增 broker-book · positions 实时仓位）    美股·A股·OKX 核心自选报价与涨跌幅  |
+---------------------------------------------------------------------------------------------------+
| 第 3 行（高 220px standard）：三市场快讯 + 价格告警（盘中信息触发器）                                  |
| [ news · latest (span: 7, view: list, limit: 8) ]                   [ watchlists · alerts (span: 5) ]
|   美股/A股/加密快讯实时列表                                            逼近触发价的预警清单（距目标价最近） |
+---------------------------------------------------------------------------------------------------+
| 第 4 行（高 150px compact）：复盘与研究快捷跳板                                                      |
| [ journal-stats · recent (span: 5) ]   [ histviz · workspaces (span: 4) ]  [ backtest · favorites (span: 3) ]
|   最近 5 笔成交快速复盘                  常用 K 线工作区直达                 常用/收藏回测策略直达           |
+---------------------------------------------------------------------------------------------------+
```

**排布理由**：
- **第 1 行（6 + 3 + 3 = 12）**：打开浏览器 1 秒确认「总净值趋势、跨市场仓位分布、近期交易盈亏」三大数字；`evolution` 给 6 列确保折线横轴不拥挤。
- **第 2 行（7 + 5 = 12，设 `height: 'tall'` 340px）**：把屏幕黄金区留给最高频的「持仓表 + 自选报价表」；现阶段直接用 `portfolios · positions`（或同时切 1 个 `journal-stats · positions` 看未平交易），待完成第 7 节第 1 项补强后无缝换成 `broker-book · positions` 实时读 OKX/IBKR 仓位。
- **第 3 行（7 + 5 = 12）**：新闻流文字多给 7 列（list 视图避免 2 列窄卡片把中文标题切碎），右侧 5 列放逼近触发的价格告警，盘中一眼扫完事件与异动。
- **第 4 行（5 + 4 + 3 = 12，设 `height: 'compact'` 150px）**：把低频但每天要进的 3 个深度工作区（日志、图表、回测）收在底栏，不抢首屏空间。

---

## 7. 模块级工作量排序：如果只做 3 件事

按「对美股·A股·OKX永续单人交易者的**直接可用性提升 / 投入工时**」ROI 从高到低排序：

### 第 1 件事：修通「实盘持仓看板」与 OKX 永续账本/报价断层（最高优先级，消除数据错误）
- **为什么排第 1**：现在 OKX 永续空单导入组合会直接算错成假盈利（`ledger.rs:108-126`），组合刷不到 OKX 价（`portfolios/prices.rs:324`），且首页仪表盘完全看不到实盘券商实时仓位——核心诉求「实盘持仓看板」等于是断的。
- **做什么**：
  1. 在 `dashboard` 新增 `BrokerBookWidget.svelte`（复用 `/api/brokers/{id}/book` + `/marks` + `/account`），在首页直接展示 OKX 永续多空仓位、杠杆、未实现盈亏与 IBKR 实盘持仓；
  2. 修复 `otw-store/src/portfolios/ledger.rs` 支持空头持仓与合约乘数；
  3. 在 `core/otw-core/src/portfolios/prices.rs` 与 `portfolios_api.rs` 接入 `histdata` 连接器报价（覆盖 OKX 与自建 A 股源）并补齐 `HKD`/`USDT`/`USDC`。
- **预计改动文件**：约 **8~10 个文件**（后端：`otw-store/src/portfolios/ledger.rs`、`otw-core/src/portfolios_import/broker.rs`、`portfolios/prices.rs`、`portfolios_api.rs`；前端：`dashboard/widgets/registry.js`、新增 `BrokerBookWidget.svelte`、`portfolios/api.js`、`PortfolioWidget.svelte`、`JournalStatsWidget.svelte`）。
- **预计工时**：**12 ~ 18 小时**（含 OKX 模拟盘空单/双向持仓联调与单测）。

### 第 2 件事：根治「中文 + 币种 + 时区」全站体验错位（高 ROI，立竿见影消除日常别扭）
- **为什么排第 2**：A 股在自选标 `$`、K 线 X 轴全英文、`USDT` 丢单位、中文 CSV 导不进日志/组合、全局时区改了大多页面不生效、中文表头列宽截断——这些问题每天都在眼前晃，但改动范围非常集中且风险低。
- **做什么**：
  1. 修复 `watchlists/quotes.rs` 保留原生 `currency` + `watchlists/api.js` 按币种格式化，彻底消灭 A 股标 `$`；顺手在 `watchlists/quotes.rs` 补齐 `okx` ticker 映射与允许添加连接器标的；
  2. 升级 `frontend/src/lib/format.js`（接入 `tz.value`、支持 `USDT`/`USDC` 单位、24 小时制、中文 `万/亿` 可选），替换 `Trades.svelte`/`TradesTable.svelte`/`BrokerTabs.svelte`/`QuickPanel.svelte`/`NewsWidget.svelte` 的裸 `toLocale*`；
  3. 中文化 `histviz/timeAxis.js`，修复 `BrokerTabs.svelte` 中文视觉列宽计算，清理 `Trades.svelte:400`/`TradesTable.svelte:115`/`WatchlistDetail.svelte:829` 硬编码英文，并在 `core/otw-core/src/import/dict.rs` 补齐 A 股中文券商 CSV 表头词典。
- **预计工时**：**8 ~ 12 小时**。
- **预计改动文件**：约 **11~14 个文件**（后端：`watchlists/quotes.rs`、`watchlists_api.rs`、`import/dict.rs`、`journal_fx.rs`；前端：`format.js`、`watchlists/api.js`、`views.js`、`WatchlistDetail.svelte`、`histviz/timeAxis.js`、`BrokerTabs.svelte`、`QuickPanel.svelte`、`journal/Trades.svelte`、`backtest/TradesTable.svelte`、`NewsWidget.svelte`）。

### 第 3 件事：补齐 A 股自定义数据源模板 + 打通「自选/新闻/图表/回测/仪表盘」联动断点
- **为什么排第 3**：前两件事保证「看盘准、持仓对、中文顺」，第 3 件事解决「A 股历史数据进得来、新闻和自选串得起来、研究链路不断层」。
- **做什么**：
  1. 基于已有的 `histdata/kinds` 自定义 HTTP 源引擎，新增「A 股 AKShare 自托管 HTTP 模板」预设与批量「从自选创建下载任务」接口；
  2. 在 `news` 新增美股/A 股/加密中文源一键预设包，修复 `otw-store/src/watchlists.rs:583-602` 中文新闻正则 `\m\M` 失效与自选别名匹配，把 `WatchlistDetail → News` 改为 URL `?q=` 传参不覆盖偏好；
  3. 补齐 `HistvizWidget`（`?workspace=`）与 `BacktestWidget`（`?strategy=`）深度链接，并在 `backtest` 加入最小 A 股规则开关（T+1 + 卖方单边印花税）。
- **预计改动文件**：约 **9~12 个文件**（后端：`histdata_api.rs`、`otw-store/src/watchlists.rs`、`backtest/mod.rs`；前端：`histdata` 自定义源表单、`news/FeedForm.svelte`、`routes/news/+page.svelte`、`WatchlistDetail.svelte`、`HistvizWidget.svelte`、`BacktestWidget.svelte`、`routes/histviz/+page.svelte`、`routes/backtest/+page.svelte`、`SizingStep.svelte`）。
- **预计工时**：**10 ~ 16 小时**。
