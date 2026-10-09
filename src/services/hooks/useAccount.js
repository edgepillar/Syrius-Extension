import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { fetchBalances } from '../wallet/account';
import vault from '../wallet/vault';
import useReadContext from './useReadContext';

// One place for "who am I and what do I hold".
//
// Six screens each had their own `getWalletInfo(pass, name)`: open the
// keystore, derive the key pair, await the address, fetch the account, and
// swallow whatever went wrong into a `console.error`. They differed in which
// parts they did and none of them showed the person an error. The keystore work
// now happens once at unlock, in `services/wallet/vault`, and this is the rest.
//
// The last good answer is kept across mounts so that switching tabs shows the
// balance immediately and refreshes behind it, rather than flashing zero.

const cache = { key: null, balances: [], balanceMap: {}, fetchedAt: 0, revision: 0, write: 0 };
let readSequence = 0;
const cacheListeners = new Set();
const sameKey = (left, right) => Boolean(left && right && left.context === right.context &&
  left.walletName === right.walletName && left.address === right.address && left.index === right.index &&
  left.revision === right.revision);

const useAccount = ({ balances: wantBalances = true, refreshMs = 0 } = {}) => {
  const { walletName, address, selectedAddressIndex } = useSelector((state) => state.wallet);
  const context = useReadContext();
  const [revision, setRevision] = useState(cache.revision);
  useEffect(() => {
    const update = () => setRevision(cache.revision);
    cacheListeners.add(update);
    update();
    return () => cacheListeners.delete(update);
  }, []);
  const cacheKey = useMemo(() => ({ walletName, address, index: selectedAddressIndex, context: context.key, revision }),
    [walletName, address, selectedAddressIndex, context.key, revision]);
  const isCacheWarm = context.available && sameKey(cache.key, cacheKey);

  const [state, setState] = useState({
    key: cacheKey,
    balances: isCacheWarm ? cache.balances : [],
    balanceMap: isCacheWarm ? cache.balanceMap : {},
    isLoading: wantBalances && !isCacheWarm,
    error: null,
  });

  // Guards against setting state on an unmounted component and against a slow
  // response for an address the user has already navigated away from.
  const liveKey = useRef(cacheKey);
  const mounted = useRef(true);
  const request = useRef(0);
  if (!sameKey(liveKey.current, cacheKey)) {
    liveKey.current = cacheKey;
    request.current += 1;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      if (!address || !vault.isUnlocked() || !context.isCurrent() || !sameKey(liveKey.current, cacheKey) ||
          cacheKey.revision !== cache.revision) {
        return null;
      }
      const active = ++request.current;
      const sequence = ++readSequence;
      const revision = cache.revision;
      let lifetime;
      const isCurrent = () => mounted.current && request.current === active &&
        sameKey(liveKey.current, cacheKey) && revision === cache.revision &&
        context.isCurrent() && lifetime && vault.isCurrent(lifetime);

      if (!quiet) {
        setState((previous) => ({ ...(sameKey(previous.key, cacheKey) ? previous :
          { balances: [], balanceMap: {} }), key: cacheKey, isLoading: true, error: null }));
      }
      try {
        lifetime = vault.capture();
        const addressObject = await vault.getAddressObject(selectedAddressIndex);
        if (!isCurrent()) return null;
        if (addressObject?.toString() !== address) {
          throw new Error('The selected account changed. Refresh the wallet and try again.');
        }
        const result = await fetchBalances(context.zenon, addressObject);

        if (!isCurrent()) return null;
        // An older mount's read cannot overwrite a newer cached response.
        if (sequence >= cache.write) {
          cache.key = cacheKey;
          cache.balances = result.balances;
          cache.balanceMap = result.balanceMap;
          cache.fetchedAt = Date.now();
          cache.write = sequence;
        }

        setState((previous) => isCurrent() ? {
            key: cacheKey,
            balances: result.balances,
            balanceMap: result.balanceMap,
            isLoading: false,
            error: null,
          } : previous);
        return result;
      } catch (err) {
        if (isCurrent()) {
          setState((previous) => isCurrent() ? ({ ...previous, key: cacheKey, isLoading: false, error: err }) : previous);
        }
        return null;
      }
    },
    [address, cacheKey, selectedAddressIndex, context]
  );

  useEffect(() => {
    if (!wantBalances) {
      return undefined;
    }
    // A warm cache for this address is shown straight away and refreshed
    // without a spinner.
    refresh({ quiet: isCacheWarm });

    if (!refreshMs) {
      return undefined;
    }
    const timer = setInterval(() => refresh({ quiet: true }), refreshMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, wantBalances, refreshMs]);

  const visible = sameKey(state.key, cacheKey) && context.available ? state : {
    balances: isCacheWarm ? cache.balances : [], balanceMap: isCacheWarm ? cache.balanceMap : {},
    isLoading: wantBalances && context.available && !isCacheWarm, error: null,
  };
  return {
    address,
    selectedAddressIndex,
    balances: visible.balances,
    balanceMap: visible.balanceMap,
    isLoading: visible.isLoading,
    error: visible.error,
    refresh,
  };
};

// Lets a screen that has just sent something drop the cached balances so the
// next mount does not show a stale number.
const invalidateAccountCache = () => {
  cache.revision += 1;
  cache.key = null;
  cache.balances = [];
  cache.balanceMap = {};
  cacheListeners.forEach((listener) => listener());
};

export { useAccount, invalidateAccountCache };
export default useAccount;
