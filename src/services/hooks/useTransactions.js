import { useCallback, useEffect, useRef, useState } from 'react';
import useReadContext from './useReadContext';

import { embeddedContractName } from '../utils/contracts';
import { decodeCall, describeCall, contractDisplayName } from '../utils/contractCalls';
// Shared with the in-flight rows on the dashboard, so a block looks the same
// on its way out as it does once it has landed.
import { iconForContract } from '../utils/outgoingBlock';

// Account history, paged.
//
// The dashboard asked for 200 blocks at a time and then, for every one of them
// that was a receive, made a second call to look up the block it referenced —
// so opening the wallet could fire two hundred sequential RPC calls before it
// drew anything. Twenty is more than fits on the screen, and the lookups for a
// page run together rather than one after another.

const pageSize = 20;

// What a block did, from the block itself.
//
// The old version compared the destination against three address constants and
// called everything else "sent", so a fuse and an unfuse were both "Fused", a
// stake and an unstake were both "Staked", and a swap was "Sent 0".
const identify = (block, myAddress) => {
  const to = block.toAddress?.toString();
  const from = block.address?.toString();

  if (to === myAddress) {
    // Incoming. A payout from a contract — a collected reward, a returned
    // stake, an unlocked swap — is named after the contract that sent it,
    // because the sending block carries no call data of its own.
    const fromContract = embeddedContractName(from);

    return {
      type: 'received',
      label: 'Received',
      icon: 'receive',
      counterpartyName: fromContract ? contractDisplayName(fromContract) : null,
    };
  }

  const contract = embeddedContractName(to);

  if (!contract) {
    return { type: 'sent', label: 'Sent', icon: 'send', counterpartyName: null };
  }

  const method = decodeCall(contract, block.data);

  return {
    type: contract,
    label: describeCall(contract, method),
    icon: iconForContract[contract] || 'contract',
    counterpartyName: contractDisplayName(contract),
    method,
  };
};

const emptyView = (selection = null) => ({ selection, items: [], isLoading: false, hasMore: true, error: null });

const useTransactions = (addressObject, address) => {
  const context = useReadContext();
  const [view, setView] = useState(emptyView);
  const selection = useRef(null);
  const mounted = useRef(true);
  if (!selection.current || selection.current.context !== context.key ||
      selection.current.address !== address || selection.current.addressObject !== addressObject) {
    selection.current = { context: context.key, address, addressObject, page: 0, loading: null, newest: null };
  }
  const activeSelection = selection.current;
  const isSelectionCurrent = () => {
    try {
      // The dashboard derives this object asynchronously after selecting an
      // address. Never query the previous object under the new account label.
      return mounted.current && selection.current === activeSelection && context.isCurrent() &&
        Boolean(address && addressObject && addressObject.toString() === address);
    } catch (error) { return false; }
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; selection.current = null; };
  }, []);

  // Receive rows reference a send block for display. This never supplies the
  // own-account hash used by the pending-placeholder observation below.
  const expand = useCallback(async (zenon, block) => {
    const json = block.toJson();
    if (Number(json.blockType) !== 3) return json;
    try {
      return (await zenon.ledger.getBlockByHash(json.fromBlockHash)).toJson();
    } catch (err) { return json; }
  }, []);

  const transform = useCallback(
    (block, own) => {
      const { type, label, icon, counterpartyName, method } = identify(block, address);

      return {
        type,
        label,
        icon,
        method,
        counterpartyName,
        // A contract call moves no coins of its own; showing "0 ZNN" against a
        // delegation reads as a failed transfer.
        amount: block.amount ?? 0,
        decimals: block.token?.decimals,
        tokenSymbol: block.token?.symbol || '',
        // The other side of the transfer. For a receive, `block` is the
        // origin send block (see `expand`), and on that block `toAddress` is
        // this account, not the counterparty — the sender is `address`. A
        // receive block's own `address`/`toAddress` pair (burn address as the
        // destination) carries no such thing.
        address: (type === 'received' ? block.address : block.toAddress)?.toString() || '',
        // The block that actually carries this transfer, for the explorer
        // link: the origin send block for a receive (again, what `block` is
        // once expanded), the account's own block otherwise. Confirmation
        // status is still read from `own` below — that's a fact about the
        // block in my chain, and for a receive the referenced send block was
        // confirmed long before mine was.
        hash: block.hash,
        isUnconfirmed: !own.confirmationDetail,
        confirmations: own.confirmationDetail?.numConfirmations ?? 0,
      };
    },
    [address]
  );

  const loadMore = useCallback(async () => {
    if (!isSelectionCurrent() || activeSelection.loading || !addressObject || !address ||
        (view.selection === activeSelection && !view.hasMore)) return;
    const request = {};
    activeSelection.loading = request;
    const isCurrent = isSelectionCurrent;
    const update = (operation) => setView((previous) => isCurrent()
      ? operation(previous.selection === activeSelection ? previous : emptyView(activeSelection)) : previous);
    update((previous) => ({ ...previous, isLoading: true }));
    try {
      const response = await context.zenon.ledger.getBlocksByPage(addressObject, activeSelection.page, pageSize);
      if (!isCurrent()) return;
      const list = response?.list || [];
      if (!list.length) {
        update((previous) => ({ ...previous, hasMore: false }));
        return;
      }
      const expanded = await Promise.all(list.map((block) => expand(context.zenon, block)));
      if (!isCurrent()) return;
      const rows = expanded.map((block, index) => transform(block, list[index]));
      activeSelection.page += 1;
      update((previous) => ({ ...previous, items: [...previous.items, ...rows], error: null,
        hasMore: list.length === pageSize }));
    } catch (err) {
      update((previous) => ({ ...previous, error: err, hasMore: false }));
    } finally {
      // A retired request must never release a newer page's loading ownership.
      if (isCurrent() && activeSelection.loading === request) {
        update((previous) => ({ ...previous, isLoading: false }));
        activeSelection.loading = null;
      }
    }
  // isSelectionCurrent closes over only this selection and context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelection, context, addressObject, address, expand, transform, view.selection, view.hasMore]);

  const refreshNewest = useCallback(async () => {
    if (!addressObject || !address || !isSelectionCurrent()) return;
    const request = {};
    activeSelection.newest = request;
    const isCurrent = () => isSelectionCurrent() && activeSelection.newest === request;
    try {
      const response = await context.zenon.ledger.getBlocksByPage(addressObject, 0, pageSize);
      const list = response?.list || [];
      if (!list.length || !isCurrent()) return;
      const expanded = await Promise.all(list.map((block) => expand(context.zenon, block)));
      const rows = expanded.map((block, index) => transform(block, list[index]));
      if (!isCurrent()) return;
      setView((previous) => {
        if (!isCurrent()) return previous;
        const before = previous.selection === activeSelection ? previous : emptyView(activeSelection);
        const known = new Set(before.items.map((row) => row.hash));
        const updated = before.items.map((row) => rows.find((fresh) => fresh.hash === row.hash) || row);
        const added = rows.filter((row) => !known.has(row.hash));
        return { ...before, items: [...added, ...updated] };
      });
      // Exact original own-account hashes, account and network tuple remain
      // mandatory. An expanded receive's send-reference hash is not observed.
      const hashes = list.filter((block) => block.address?.toString() === address)
        .map((block) => block.hash?.toString()).filter((hash) => typeof hash === 'string' && hash);
      return { owner: address, network: context.network, hashes, isCurrent };
    } catch (err) { /* Failed reads preserve current rows and unseen placeholders. */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelection, context, addressObject, address, expand, transform]);

  const reset = useCallback(() => {
    if (selection.current !== activeSelection) return;
    const next = { ...activeSelection, page: 0, loading: null, newest: null };
    selection.current = next;
    setView(emptyView(next));
  }, [activeSelection]);

  const visible = context.available && view.selection === activeSelection ? view : emptyView(activeSelection);
  return { items: visible.items, isLoading: visible.isLoading, hasMore: visible.hasMore, error: visible.error,
    loadMore, reset, refreshNewest, hasPending: visible.items.some((row) => row.isUnconfirmed),
    isEmpty: !visible.items.length && !visible.hasMore,
  };
};

export default useTransactions;
