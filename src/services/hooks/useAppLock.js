import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';

import app from '../utils/app';
import lockWallet from '../wallet/lock';
import lease from '../wallet/sessionLease';
import { getSettings } from '../utils/storage';
import { notify } from '../utils/notify';
import { resetWalletState } from '../redux/walletSlice';
import { resetPendingTransactions } from '../redux/pendingTransactionsSlice';
import { invalidateAccountCache } from './useAccount';

// Native foreground locking follows every unlocked screen, including the
// biometric offer before the tab layout mounts. The phone's own biometric
// prompt, scanner and share sheet keep their existing `own` exception.
const useAppLock = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    const native = app();
    if (!native) return undefined;
    return native.onLifecycle(async ({ state, own, away }) => {
      if (state !== 'foreground' || own) return;
      const minutes = getSettings().autoLockMinutes;
      if (minutes === lease.never || away < minutes * 60000) return;
      try {
        await lockWallet();
        invalidateAccountCache();
        dispatch(resetWalletState());
        dispatch(resetPendingTransactions());
        navigate('/password', { replace: true });
      } catch (error) { notify.error(error); }
    });
  }, [dispatch, navigate]);
};

export default useAppLock;
