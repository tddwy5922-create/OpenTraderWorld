<!--
  The live book, as the venues hold it: every open position of every connected trading account
  in one card, with the figures a leveraged position is judged by — direction, leverage, entry
  and mark, unrealized PnL, liquidation price and the funding paid so far.

  Read-only by construction: it only reads `brokersApi.list()` and `brokersApi.positions()`,
  never an order path. Fresh from the venue on every poll, so it keeps telling the truth while
  the position is open (a portfolio snapshot cannot: it is written once, at import).
-->
<script>
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { brokersApi } from '$lib/brokers/api.js';
  import { fmtMoney, fmtNum, fmtSignedMoney, fmtPct } from '$lib/format.js';
  import WidgetState from './WidgetState.svelte';

  let { editing = false, limit = 8, accountIds = null } = $props();

  let rows = $state(null);
  let error = $state('');
  let timer = null;

  async function load() {
    try {
      const accounts = await brokersApi.list();
      const wanted = (accounts ?? []).filter((a) => !accountIds || accountIds.includes(a.id));
      const out = [];
      for (const a of wanted) {
        const positions = await brokersApi.positions(a.id).catch(() => []);
        for (const p of positions ?? []) out.push({ ...p, account: a.name || a.broker });
      }
      out.sort((x, y) => Math.abs(y.unrealized_pnl ?? 0) - Math.abs(x.unrealized_pnl ?? 0));
      rows = out;
      error = '';
    } catch (e) {
      error = e.message;
      rows = rows ?? [];
    }
  }

  load();
  timer = setInterval(load, 15000);
  onDestroy(() => clearInterval(timer));

  const shown = $derived((rows ?? []).slice(0, Math.max(1, Number(limit) || 8)));
  const total = $derived((rows ?? []).reduce((s, p) => s + (Number(p.unrealized_pnl) || 0), 0));
  const ccy = $derived(shown[0]?.currency || 'USD');
  const leveraged = $derived(shown.some((p) => p.leverage != null || p.margin_mode));

  /// How far the mark sits from the liquidation price, in percent of the mark. Positive is
  /// room left; anything under 10% is the red zone.
  function toLiq(p) {
    const liq = Number(p.liquidation_price);
    const mark = Number(p.market_price ?? p.avg_price);
    if (!liq || !mark) return null;
    return ((mark - liq) / mark) * 100 * (p.side === 'short' ? -1 : 1);
  }
</script>

<WidgetState {editing} {error} loading={rows === null} empty={rows?.length === 0} rows={3}
  preview={$t('dashboard.brokerbook.preview')} emptyText={$t('dashboard.brokerbook.empty')}>
  <div class="book" class:lev={leveraged}>
    <div class="head">
      <span class="sym">{$t('dashboard.brokerbook.position')}</span>
      <span class="n">{$t('dashboard.brokerbook.qty')}</span>
      <span class="n">{$t('dashboard.brokerbook.mark')}</span>
      <span class="n">{$t('dashboard.brokerbook.pnl')}</span>
      {#if leveraged}
        <span class="n">{$t('dashboard.brokerbook.leverage')}</span>
        <span class="n">{$t('dashboard.brokerbook.liq')}</span>
      {/if}
    </div>
    {#each shown as p, i (i)}
      <div class="row">
        <span class="sym">
          <span class="side" class:short={p.side === 'short'}>{p.side === 'short' ? $t('dashboard.brokerbook.short') : $t('dashboard.brokerbook.long')}</span>
          {p.symbol}
          <span class="acct">{p.account}</span>
        </span>
        <span class="n mono">{fmtNum(Math.abs(Number(p.qty) || 0), 4)}</span>
        <span class="n mono">{fmtNum(Number(p.market_price ?? p.avg_price) || 0, 4)}</span>
        <span class="n mono" class:gain={Number(p.unrealized_pnl) > 0} class:loss={Number(p.unrealized_pnl) < 0}>
          {fmtSignedMoney(Number(p.unrealized_pnl) || 0, p.currency || ccy)}
        </span>
        {#if leveraged}
          <span class="n mono muted">{p.leverage != null ? `${fmtNum(Number(p.leverage), 1)}×` : '–'}</span>
          <span class="n mono" class:tight={toLiq(p) != null && toLiq(p) < 10}>
            {p.liquidation_price ? fmtNum(Number(p.liquidation_price), 4) : '–'}
            {#if toLiq(p) != null}<span class="dist">{fmtPct(toLiq(p), 1)}</span>{/if}
          </span>
        {/if}
      </div>
    {/each}
    <div class="foot">
      <span>{$t('dashboard.brokerbook.total')}</span>
      <span class="mono" class:gain={total > 0} class:loss={total < 0}>{fmtSignedMoney(total, ccy)}</span>
    </div>
  </div>
</WidgetState>

<style>
  .book { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-sm, 12px); }
  .head, .row { display: grid; grid-template-columns: 1fr 70px 74px 84px; gap: 6px; align-items: center; }
  .book.lev .head, .book.lev .row { grid-template-columns: 1fr 66px 70px 82px 46px 96px; }
  .head { color: var(--muted); font-size: 11px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  .head > span:not(.sym) { text-align: right; }
  .row { padding: 3px 0; border-bottom: 1px solid var(--line-faint, rgba(255,255,255,.04)); }
  .sym { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acct { color: var(--muted); font-size: 10px; margin-left: 6px; }
  .side { display: inline-block; padding: 0 4px; margin-right: 4px; border-radius: 3px; font-size: 10px;
          background: color-mix(in srgb, var(--buy, #2e9e5b) 22%, transparent); color: var(--buy, #2e9e5b); }
  .side.short { background: color-mix(in srgb, var(--sell, #d9534f) 22%, transparent); color: var(--sell, #d9534f); }
  .n { text-align: right; }
  .mono { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .gain { color: var(--buy, #2e9e5b); }
  .loss { color: var(--sell, #d9534f); }
  .tight { color: var(--sell, #d9534f); }
  .dist { color: var(--muted); font-size: 10px; margin-left: 4px; }
  .foot { display: flex; justify-content: space-between; padding-top: 5px; color: var(--muted); }
</style>
