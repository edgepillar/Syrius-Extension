import { createSlice } from '@reduxjs/toolkit';
import { sameHistoryNetwork } from '../wallet/historyObservation';

// Outgoing blocks that have been submitted but are not in the account's chain
// yet.
//
// An account with no fused QSR pays for each block with proof of work, which
// takes seconds, and the wallet used to spend them behind a modal spinner: the
// screen was unusable, the balance was hidden, and the only way out was to
// close the popup — which killed the work. The send runs in the background now
// and the dashboard reports it, so the record of it has to live above any one
// screen: the page that started the send unmounts the moment it navigates home.
//
// Amounts are held as base-unit strings rather than BigNumber. Everything in
// here goes through the store, and a BigNumber is not serializable.

const pendingStatus = {
  // Signed and on its way, or waiting on the node.
  sending: 'sending',
  // Computing a nonce because the account cannot pay for the block out of
  // fused plasma. This is the slow one.
  generatingPlasma: 'generating-plasma',
  // Accepted by the node. The row stays until the dashboard has folded the real
  // block into its history, so it never blinks out and back in.
  settled: 'settled',
  failed: 'failed',
};

const initialState = { items: [] };

export const pendingTransactionsSlice = createSlice({
  name: 'pendingTransactions',
  initialState,
  reducers: {
    startPendingTransaction: (state, action) => {
      state.items.unshift({ status: pendingStatus.sending, ...action.payload });
    },
    // Merges, so a settle can carry the block hash and a failure its message
    // without either needing a reducer of its own.
    updatePendingTransaction: (state, action) => {
      const { id, ...changes } = action.payload;
      const entry = state.items.find((item) => item.id === id);

      if (entry) {
        Object.assign(entry, changes);
      }
    },
    clearPendingTransaction: (state, action) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
    },
    clearSettledTransactions: (state, action) => {
      const { owner, network, hashes } = action.payload || {};
      if (typeof owner !== 'string' || !owner || !Array.isArray(hashes)) return;
      const observed = new Set(hashes.filter((hash) => typeof hash === 'string' && hash));
      // A node-accepted row remains until its exact block is observed in the
      // same account/network. Missing context is not evidence of observation.
      state.items = state.items.filter((item) => !(item.status === pendingStatus.settled &&
        item.owner === owner && sameHistoryNetwork(item.network, network) && observed.has(item.hash)));
    },
    // On lock, and on switching address: what is on screen belongs to the
    // account that was open.
    resetPendingTransactions: () => initialState,
  },
});

export const {
  startPendingTransaction,
  updatePendingTransaction,
  clearPendingTransaction,
  clearSettledTransactions,
  resetPendingTransactions,
} = pendingTransactionsSlice.actions;

export { pendingStatus };

export default pendingTransactionsSlice.reducer;
