-- Portfolio Tracker: OKX as a price source.
--
-- The override list left OKX out, so a portfolio holding an OKX perpetual had no way to be
-- priced off the venue it is actually traded on. The symbol typed here is an OKX instId
-- ("BTC-USDT" for spot, "BTC-USDT-SWAP" for a perpetual, which prices off the mark).
ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_spot_provider_check;
ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_spot_provider_check
    CHECK (spot_provider IS NULL OR spot_provider IN
        ('coingecko', 'yahoo', 'binance', 'kraken', 'coinbase', 'okx'));
