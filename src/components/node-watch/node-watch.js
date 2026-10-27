import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

import app from '../../services/utils/app';
import vault from '../../services/wallet/vault';
import { checkNode } from '../../services/wallet/bootstrap';

const tickMs = 5000;
const retryMs = 15000;

const NodeWatch = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    let stopped = false;
    let retryAt = 0;
    const isCurrent = () => !stopped && vault.isUnlocked();
    const check = (options) => {
      if (!isCurrent()) return;
      checkNode(dispatch, isCurrent, options)
        .then((ok) => { retryAt = ok === false ? Date.now() + retryMs : 0; })
        .catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onOnline = () => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const native = app();
    const stopLifecycle = native?.onLifecycle(({ state }) => { if (state === 'foreground') check(); });
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden' || native?.inBackground() || Date.now() < retryAt) return;
      check({ probe: false });
    }, tickMs);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      stopLifecycle?.();
    };
  }, [dispatch]);

  return null;
};

export default NodeWatch;
