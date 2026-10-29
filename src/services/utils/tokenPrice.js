import { fail } from './errors';

// Live USD prices for ZNN and QSR.

const coingeckoIds = {
  znn: 'zenon-2',
};

const wqsrEthereum = '0x96546afe4a21515a3a30cd3fd64a70eb478dc174';

const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds.znn}&vs_currencies=usd`;
const qsrPriceUrl = `https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${wqsrEthereum}`;

const finite = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
};

const getJson = async (url) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw fail(106, { status: response.status });
  }
  return response.json();
};

// `null` for either token the response did not carry a price for, rather than
// throwing — a price feed having nothing to say about one token is not reason
// enough to take the whole dashboard down.
const fetchTokenPrices = async () => {
  const [znn, qsr] = await Promise.allSettled([
    getJson(priceUrl).then((json) => finite(json?.[coingeckoIds.znn]?.usd)),
    getJson(qsrPriceUrl).then((json) => finite(json?.data?.attributes?.token_prices?.[wqsrEthereum])),
  ]);

  if (znn.status === 'rejected' && qsr.status === 'rejected') {
    const error = znn.reason;
    throw error;
  }
  return {
    znn: znn.status === 'fulfilled' ? znn.value : null,
    qsr: qsr.status === 'fulfilled' ? qsr.value : null,
  };
};

export { coingeckoIds, wqsrEthereum, priceUrl, qsrPriceUrl, fetchTokenPrices };
