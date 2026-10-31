import { useEffect, useRef } from 'react';
import { useDispatch, useStore } from 'react-redux';

import { hostForget, hostReady, onHostState } from '../../services/wallet/blockService';
import { upsertPendingTransaction } from '../../services/redux/pendingTransactionsSlice';
import { emitChainChange } from '../../services/wallet/chainEvents';
import { markAccountStale } from '../../services/hooks/useAccount';

// The background page's blocks, on this popup's screens
// (wallet/blockService.js). Its jobs become rows in the pending transactions,
// so a send started before the popup closed is there again when it opens,
// still counting down, and settles or fails in place. A row this popup lets go
// of (folded into history, dismissed) is let go of there too. When blocks have
// been received, the balance and history are read again. Renders nothing.
const BlockSync = () => {
  const dispatch = useDispatch();
  const store = useStore();
  const fromHost = useRef(new Set());
  const forgotten = useRef(new Set());
  const received = useRef(null);

  useEffect(() => {
    hostReady();
    return onHostState((state) => {
      if (!state) return;
      // Newest first in the host, and each lands on top: oldest goes in first.
      [...state.jobs].reverse().forEach((job) => {
        if (forgotten.current.has(job.id)) return;
        fromHost.current.add(job.id);
        dispatch(upsertPendingTransaction(job));
      });
      if (received.current !== null && state.received !== received.current) {
        markAccountStale();
        emitChainChange('received');
      }
      received.current = state.received;
    });
  }, [dispatch]);

  // Read from the store itself rather than a render's copy, so a row added
  // a moment ago is never taken for one that went.
  useEffect(() => store.subscribe(() => {
    const present = new Set(store.getState().pendingTransactions.items.map((item) => item.id));
    const gone = [...fromHost.current].filter((id) => !present.has(id));
    if (!gone.length) return;
    gone.forEach((id) => {
      fromHost.current.delete(id);
      forgotten.current.add(id);
    });
    hostForget(gone);
  }), [store]);

  return null;
};

export default BlockSync;
