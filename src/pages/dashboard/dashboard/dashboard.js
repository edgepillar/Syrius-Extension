import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Zenon } from 'znn-ts-sdk';

import TransactionItem from '../../../components/transaction-item/transaction-item';
import Icon from '../../../components/icon/icon';
import ZapModal from '../../../components/modals/zap-modal';
import { ModalContext } from '../../../services/hooks/modal/modalContext';
import { takeNew } from '../../../services/zap/zap';
import { inPhase } from '../../../services/utils/edgeLight';
import useAccount from '../../../services/hooks/useAccount';
import useTransactions from '../../../services/hooks/useTransactions';
import useDelayedFlag from '../../../services/hooks/useDelayedFlag';
import usePriceFeed from '../../../services/hooks/usePriceFeed';
import useChainChange from '../../../services/hooks/useChainChange';
import usePullToRefresh from '../../../services/hooks/usePullToRefresh';
import { receiveOnce } from '../../../services/wallet/outgoingWatch';
import { hostReady, hostReceive, onHostState } from '../../../services/wallet/blockService';
import vault from '../../../services/wallet/vault';
import {
  countPendingBlocks,
  receivePendingBlocks,
  receivePhase,
  znnZts,
  qsrZts,
} from '../../../services/wallet/account';
import { describePendingBlock } from '../../../services/utils/outgoingBlock';
import { formatAmount, formatExact, formatUsd } from '../../../services/utils/format';
import { notify } from '../../../services/utils/notify';
import { updateSetting } from '../../../services/wallet/preferences';
import { getSettings } from '../../../services/utils/storage';
import {
  pendingStatus,
  clearPendingTransaction,
  clearSettledTransactions,
} from '../../../services/redux/pendingTransactionsSlice';

// The wallet's front page.
//
// It used to open by silently receiving every pending block on the account
// before it would show anything — an unbounded loop of on-chain transactions,
// each one possibly generating proof of work, behind a spinner, that the person
// had not asked for and could not stop. Receiving is still offered, and still
// happens on its own when the setting is on, but it is bounded, it says what it
// is doing, and it never blocks the first paint.

const historyPollMs = 3000;

const Dashboard = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { address, balanceMap, isLoading, refresh } = useAccount();
  // Blocks this wallet has sent that are not in the account's chain yet. They
  // outlive the screen that started them, which is the whole point.
  const allOutgoing = useSelector((state) => state.pendingTransactions.items);
  const { isConnected } = useSelector((state) => state.connectionParameters);
  // Prices are mainnet's. Every Zenon chain shows the balance at them, as a
  // sense of scale (owner's request, 2026-10-11).
  const prices = usePriceFeed(isConnected);

  const [addressObject, setAddressObject] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveProgress, setReceiveProgress] = useState('');
  // The block being received at this moment, and whether it is paying for
  // itself with proof of work. Null whenever nothing is in flight.
  const [ownReceivingBlock, setReceivingBlock] = useState(null);
  // What the background page is receiving for this account (wallet/blockService.js).
  const [hostReceiving, setHostReceiving] = useState(null);
  useEffect(() => onHostState((state) => setHostReceiving(state?.receiving || null)), []);
  const receivingBlock = ownReceivingBlock || (hostReceiving && hostReceiving.owner === address ? hostReceiving : null);
  const [hideBalances, setHideBalances] = useState(() => getSettings().hideBalances);

  // A send belongs to the address that made it; switching address should not
  // show it under the new one.
  const outgoing = useMemo(
    () => allOutgoing.filter((entry) => !entry.owner || entry.owner === address),
    [allOutgoing, address]
  );

  const transactions = useTransactions(addressObject, address);
  // Destructured because the hook returns a fresh object each render: an effect
  // that depended on `transactions` would re-run every time, and one that
  // depended on nothing would close over a stale `loadMore`.
  const {
    loadMore: loadMoreTransactions,
    refreshNewest: refreshNewestTransactions,
    hasPending,
  } = transactions;
  const loadMoreRef = useRef(null);
  const hasAutoReceived = useRef(false);

  // Zaps (services/zap/zap.js). One that has just arrived is celebrated once:
  // a burst, and its message. Its row keeps a button that opens it again.
  const { openModal } = useContext(ModalContext);
  const [zapBurst, setZapBurst] = useState(0);
  const showZap = useCallback(
    (row) => openModal(
      <ZapModal counterparty={row.address} sent={row.type !== 'received'} amount={row.amount} decimals={row.decimals} tokenSymbol={row.tokenSymbol} message={row.zap.message} />
    ),
    [openModal]
  );
  const transactionItems = transactions.items;
  useEffect(() => {
    const arrived = transactionItems.filter((row) => row.type === 'received' && row.zap?.message && !row.isUnconfirmed);
    const fresh = takeNew(address, arrived.map((row) => String(row.hash)));
    if (!fresh.length) return;
    setZapBurst((count) => count + 1);
    showZap(arrived.find((row) => String(row.hash) === fresh[0]));
  }, [transactionItems, address, showZap]);

  useEffect(() => {
    let cancelled = false;

    vault
      .getAddressObject()
      .then((object) => {
        if (!cancelled) {
          setAddressObject(object);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [address]);

  const refreshPending = useCallback(async () => {
    if (!addressObject) {
      return;
    }
    try {
      setPendingCount(await countPendingBlocks(Zenon.getSingleton(), addressObject));
    } catch (err) {
      // The node is unreachable; the header already says so.
    }
  }, [addressObject]);

  const clearObserved = useCallback((observation) => {
    if (!observation?.isCurrent()) return;
    const { owner, network, hashes } = observation;
    dispatch(clearSettledTransactions({ owner, network, hashes }));
  }, [dispatch]);

  const receive = useCallback(async () => {
    if (!addressObject || isReceiving) {
      return;
    }
    // The background page receives while it is there, popup or no popup; its
    // row shows here as it goes.
    if (await hostReady()) {
      hostReceive();
      return;
    }
    setIsReceiving(true);
    setReceiveProgress('Receiving…');

    try {
      // One receive at a time across screens: the watcher may have started
      // one on the screen just left, and this then waits for it.
      const received = await receiveOnce(async () => receivePendingBlocks(Zenon.getSingleton(), await vault.getSigningKeyPair(), addressObject, {
        onProgress: (done, total) => setReceiveProgress(`Receiving ${done} of ${total}…`),
        onBlock: (block, phase) => {
          if (phase === receivePhase.done) {
            setReceivingBlock(null);
            return;
          }
          setReceivingBlock({
            ...describePendingBlock(block),
            isGeneratingPlasma: phase === receivePhase.generatingPlasma,
          });
        },
      }));

      // No toast: the received blocks appear in the list below.
      if (received > 0) {
        await refresh({ quiet: true });
        refreshNewestTransactions().then(clearObserved, () => {});
      }
      await refreshPending();
    } catch (err) {
      // The pending banner stays, so the receive can be tried again from it.
      setReceiveProgress('');
    } finally {
      setIsReceiving(false);
      setReceiveProgress('');
      setReceivingBlock(null);
    }
  }, [addressObject, isReceiving, refresh, refreshPending, refreshNewestTransactions, clearObserved]);

  // Auto-receive is a setting now, and runs once per mount rather than on every
  // render pass that happened to re-enter the effect.
  useEffect(() => {
    if (!addressObject) {
      return;
    }
    refreshPending().then(() => {
      if (getSettings().autoReceive && !hasAutoReceived.current) {
        hasAutoReceived.current = true;
        countPendingBlocks(Zenon.getSingleton(), addressObject)
          .then((count) => (count > 0 ? receive() : null))
          .catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressObject]);

  // What the layout's watcher saw (components/outgoing-watch): a block of
  // this wallet's confirmed, or something arrived for it. Both used to be
  // found out only by opening Home again, since auto-receive runs once a mount.
  useChainChange((kind) => {
    if (kind === 'incoming') {
      refreshPending();
      if (getSettings().autoReceive) receive();
      return;
    }
    refreshNewestTransactions().then(clearObserved, () => {});
    refresh({ quiet: true });
  });

  const puller = usePullToRefresh(() => Promise.allSettled([
    refresh({ quiet: true }),
    refreshNewestTransactions().then(clearObserved),
    refreshPending(),
  ]));

  // Infinite scroll, observing a sentinel at the end of the list.
  useEffect(() => {
    const sentinel = loadMoreRef.current;

    if (!sentinel || !addressObject) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreTransactions();
        }
      },
      { threshold: 1.0 }
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [addressObject, loadMoreTransactions]);

  // Node acceptance does not establish that history has caught up. Retain each
  // placeholder until its exact hash is observed in its account/network.
  const hasSettled = outgoing.some((entry) => entry.status === pendingStatus.settled);

  useEffect(() => {
    if (!hasSettled) {
      return undefined;
    }
    let cancelled = false;
    let refreshing = false;

    const observe = async () => {
      if (cancelled || refreshing) return;
      refreshing = true;
      try {
        const observation = await refreshNewestTransactions();
        await refresh({ quiet: true });
        if (!cancelled && observation?.isCurrent()) {
          const { owner, network, hashes } = observation;
          dispatch(clearSettledTransactions({ owner, network, hashes }));
        }
      } catch (error) {
        // A failed read is not evidence that any placeholder was observed.
      } finally {
        refreshing = false;
      }
    };
    observe();
    const timer = setInterval(observe, historyPollMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasSettled, refreshNewestTransactions, refresh, dispatch]);

  // Only while a block is waiting on a momentum, so the wallet is not polling
  // the node for the sake of it. The effect tears itself down when the last
  // pending row confirms.
  useEffect(() => {
    if (!hasPending || hasSettled) {
      return undefined;
    }
    const timer = setInterval(() => {
      refreshNewestTransactions().then(clearObserved, () => {});
      refresh({ quiet: true });
    }, historyPollMs);

    return () => clearInterval(timer);
  }, [hasPending, hasSettled, refreshNewestTransactions, refresh, clearObserved]);

  const toggleHidden = async () => {
    try {
      const settings = await updateSetting('hideBalances', !hideBalances);
      setHideBalances(settings.hideBalances);
    } catch (error) { notify.error(error); }
  };

  const znn = balanceMap[znnZts];
  const qsr = balanceMap[qsrZts];

  // For display only: whether to actually show a "Loading…" label at the
  // bottom of the list. See `useDelayedFlag`.
  const showLoading = useDelayedFlag(transactions.isLoading || isLoading);

  // A plain JS number for multiplying against a USD price. Losing precision
  // past 2^53 units is not a concern here — this feeds a rounded dollar
  // estimate, not another on-chain amount.
  const tokenAmountNumber = (entry) => {
    const value = parseFloat(formatExact(entry?.balance, entry?.token?.decimals));
    return Number.isFinite(value) ? value : 0;
  };

  // Four figures or more already reads fine without decimals, and dropping
  // them is what keeps a balance this size from overflowing its half of the
  // row into an ellipsis. Read straight off `formatExact`'s string rather
  // than round-tripping through a float, so a whole-number count this large
  // is never at the mercy of floating-point precision.
  const renderBalance = (entry) => {
    if (hideBalances) {
      return '••••';
    }
    const wholeDigits = formatExact(entry?.balance, entry?.token?.decimals)
      .split('.')[0]
      .replace('-', '').length;
    return formatAmount(entry?.balance, entry?.token?.decimals, {
      maxDecimals: wholeDigits >= 4 ? 0 : 4,
    });
  };

  const znnUsdValue = prices.znn !== null ? tokenAmountNumber(znn) * prices.znn : null;
  const qsrUsdValue = prices.qsr !== null ? tokenAmountNumber(qsr) * prices.qsr : null;
  // Whichever side of the pair has a live price still contributes, rather
  // than the total going blank because only one token's price came back.
  const totalUsdValue =
    znnUsdValue !== null || qsrUsdValue !== null ? (znnUsdValue || 0) + (qsrUsdValue || 0) : null;

  const renderUsd = (value) => (hideBalances ? '••••' : formatUsd(value));

  return (
    <div
      ref={puller.ref}
      className={`page dashboard-page ${puller.dragging ? 'is-pulling' : ''}`}
      style={puller.pull ? { transform: `translateY(${puller.pull}px)` } : undefined}
    >
      <div
        className={`pull-refresh ${puller.armed ? 'is-armed' : ''} ${puller.refreshing ? 'is-refreshing' : ''}`}
        style={{ opacity: puller.progress, '--pull-turn': `${puller.progress * 270}deg` }}
        role={puller.refreshing ? 'status' : undefined}
        aria-label={puller.refreshing ? 'Refreshing' : undefined}
      >
        <Icon name="refresh" size={18} />
      </div>
      {zapBurst > 0 && (
        <div className="zap-burst" key={zapBurst} aria-hidden="true">
          {Array.from({ length: 12 }, (_, spark) => <span key={spark} style={{ '--spark': spark }} />)}
        </div>
      )}

      {/* In phase with the clock, so the light does not start again from the
          top each time Home is opened (services/utils/edgeLight.js). */}
      <section className="balance-card" ref={inPhase}>
        {/* What the two balances below are worth together, on the card's
            first line, where it is read first. */}
        <div className="balance-head">
          <span className="ledger-label">Balance</span>
          {totalUsdValue !== null && (
            <span className="balance-total" title="ZNN + QSR at market price">
              ≈ {renderUsd(totalUsdValue)}
            </span>
          )}
        </div>

        <div className="balance-row">
          <button
            type="button"
            className="balance-figure"
            onClick={toggleHidden}
            title={hideBalances ? 'Show balances' : 'Hide balances'}
          >
            <span className="balance-amount" title={formatExact(znn?.balance, znn?.token?.decimals)}>
              {renderBalance(znn)}
            </span>
            <span className="balance-meta">
              <span className="balance-symbol znn">ZNN</span>
              {znnUsdValue !== null && (
                <span className="balance-usd">{renderUsd(znnUsdValue)}</span>
              )}
            </span>
          </button>

          <button
            type="button"
            className="balance-figure"
            onClick={toggleHidden}
            title={hideBalances ? 'Show balances' : 'Hide balances'}
          >
            <span className="balance-amount" title={formatExact(qsr?.balance, qsr?.token?.decimals)}>
              {renderBalance(qsr)}
            </span>
            <span className="balance-meta">
              <span className="balance-symbol qsr">QSR</span>
              {qsrUsdValue !== null && (
                <span className="balance-usd">{renderUsd(qsrUsdValue)}</span>
              )}
            </span>
          </button>
        </div>

      </section>

      <div className="action-row">
        <button
          type="button"
          className="button secondary w-100"
          onClick={() => navigate('send')}
        >
          <Icon name="send" size={16} />
          Send
        </button>
        <button
          type="button"
          className="button secondary w-100"
          onClick={() => navigate('receive')}
        >
          <Icon name="receive" size={16} />
          Receive
        </button>
      </div>

      {/* Only shown when there is something to act on. */}
      {(pendingCount > 0 || isReceiving) && (
        <button type="button" className="pending-banner" onClick={receive} disabled={isReceiving}>
          {isReceiving
            ? receiveProgress || 'Receiving…'
            : `${pendingCount} pending — tap to receive`}
        </button>
      )}

      <section className="activity">
        <h3 className="section-title">Activity</h3>

        {/* Blocks this wallet sent that have not landed yet. Above the receive
            in flight and above history, because they are the newest thing that
            happened and the only ones still moving. */}
        {outgoing.map((entry) => (
          <TransactionItem
            key={entry.id}
            type={entry.type}
            label={entry.label}
            icon={entry.icon}
            amount={entry.amount}
            decimals={entry.decimals}
            tokenSymbol={entry.tokenSymbol}
            address={entry.address}
            counterpartyName={entry.counterpartyName}
            isUnconfirmed
            isGeneratingPlasma={entry.status === pendingStatus.generatingPlasma}
            isFailed={entry.status === pendingStatus.failed}
            error={entry.error}
            onDismiss={
              entry.status === pendingStatus.failed
                ? () => dispatch(clearPendingTransaction(entry.id))
                : undefined
            }
          />
        ))}

        {/* The block in flight, above the settled history. It carries no hash
            yet — the receive block does not exist until this finishes — so it
            gets no explorer link. */}
        {receivingBlock && (
          <TransactionItem
            type="received"
            label="Receiving"
            icon="receive"
            amount={receivingBlock.amount}
            decimals={receivingBlock.decimals}
            tokenSymbol={receivingBlock.tokenSymbol}
            address={receivingBlock.address}
            counterpartyName={receivingBlock.counterpartyName}
            isUnconfirmed
            isGeneratingPlasma={receivingBlock.isGeneratingPlasma}
          />
        )}

        {transactions.items.map((transaction, index) => (
          <TransactionItem
            key={transaction.id || `transaction-${index}`}
            type={transaction.type}
            label={transaction.label}
            icon={transaction.icon}
            amount={transaction.amount}
            decimals={transaction.decimals}
            tokenSymbol={transaction.tokenSymbol}
            address={transaction.address}
            counterpartyName={transaction.counterpartyName}
            hash={transaction.hash}
            isUnconfirmed={transaction.isUnconfirmed}
            confirmations={transaction.confirmations}
            isZap={Boolean(transaction.zap)}
            onMessage={transaction.zap?.message ? () => showZap(transaction) : undefined}
          />
        ))}

        {/* Not "no transactions" while one is on screen waiting to land. */}
        {transactions.isEmpty && !outgoing.length && !receivingBlock && (
          <p className="empty-note">No transactions yet</p>
        )}
        {transactions.error && !transactions.items.length && (
          <p className="empty-note">Could not load activity</p>
        )}

        <div ref={loadMoreRef} className="load-more-sentinel">
          {showLoading && <span className="text-gray">Loading…</span>}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
