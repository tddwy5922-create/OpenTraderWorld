# OpenTraderWorld 简体中文语言包补齐报告

目标文件：`frontend/src/lib/i18n/zh.json`（基准：`frontend/src/lib/i18n/en.json`）

## 1. 补齐统计

- **新增缺失键**：`379` 个（全部按 `en.json` 对应位置及 2 空格缩进补入）
  - `histviz.trade.source.fromAlert`：1 个
  - `agent.trace.*`：12 个
  - `agent.persona.maxToolRounds` / `maxToolRoundsHint`：2 个
  - `histviz.alerts.scheduleTrade` 与 `histviz.alerts.trade.*`：73 个
  - `robots.exec.*` 与 `robots.dashboard.onBroker`：101 个
  - `journal.page.nav.lab` 与 `journal.lab.*`：135 个
  - `insights.*`：55 个
- **修复空字符串值**：`2` 个
- **修复英文漏译**：`3` 个
- **已有译文**：其余 11,780 条原有译文全部原样保留，未作改写。

## 2. 修改的空值与漏译明细

### 补齐的 2 个空字符串值
| 键名 | 原值 | 修正后译文 | 说明 |
| --- | --- | --- | --- |
| `portfolios.analytics.drift.chart` | `""` | `"偏离图表"` | 组合偏离分析图表标题键 |
| `oauth.lead.before` | `""` | `"客户端 "` | 拼接 `<strong>{client_name}</strong>` 与 `oauth.lead.after`（`客户端 {client_name} 请求通过 MCP 访问 OpenTraderWorld。`） |

### 修复的 3 个明显英文漏译
| 键名 | 原值（与英文相同） | 修正后译文 |
| --- | --- | --- |
| `brokers.field.site` | `"Site"` | `"站点"` |
| `agent.dump.you` | `"You"` | `"你"` |
| `security.social.issuer` | `"Issuer URL"` | `"签发方 URL"` |

> 注：其余与 `en.json` 相同的条目均为品牌名、专有名词、金融/技术缩写（如 `OpenTraderWorld`、`GitHub`、`MCP`、`ETF`、`API`、`CSV`、`JSON`、`MAE`/`MFE`、`VaR`、`Delta`–`Rho`、`RSI 14`、`Pine Script`）、数字格式示例或纯占位符模板，按要求原样保留。

## 3. python3 校验输出

校验脚本检查了 `json.load` 解析、重复键检测、与 `en.json` 的键数量与键集合一致性、空值检测、新增/修改条目占位符一致性及 2 空格缩进规范：

```text
json.load: OK
en_keys: 12164
zh_keys: 12164
key_count_match: True
duplicate_keys: 0
missing_keys: 0
extra_keys: 0
empty_values: 0
placeholder_mismatches_in_touched_keys: 0
placeholder_mismatches_total: 4
bad_indent_lines: 0
```
