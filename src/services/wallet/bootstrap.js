import { Zenon } from 'znn-ts-sdk';
import {
  storeChainIdentifier,
  storeIsConnected,
  storeNodeUrl,
} from '../redux/connectionParametersSlice';
import { walletUnlocked } from '../redux/walletSlice';
import {
  defaultNodeUrl,
  getAddressInfo,
  getCurrentNodeUrl,
  setCurrentNodeUrl,
  setLastWalletName,
} from '../utils/storage';
import { announceUnlock } from './announce';
import vault from './vault';
import { beginReadContextChange, readContextChanging } from './readContext';
import { load as loadPopupState } from '../utils/popupState';
import { fail } from '../utils/errors';

// Everything that has to happen between "this is the right password" and "the
// wallet is on screen", in the one order that works.
//
// It was inline in the password screen, and the node connection was awaited in
// the middle of it: if the node was unreachable, `zenon.initialize` threw, the
// catch showed a toast, and the unlock was abandoned — a wallet that would not
// open because a server was down, with no way to reach the node settings that
// would have fixed it. Connecting is attempted here but is not allowed to fail
// the unlock; the header reports the connection separately.
//
// Even not failing, it was still waited for: the SDK gives up on a dead node
// only after 8 s, and the person watched a bare logo (or "Unlocking…") with no
// way to do anything about it. So the wait is exposed (`waitingForNode`) and
// can be ended from the screen showing it (components/node-stall): by moving
// to another node, which then ends it with that node's outcome, or by carrying
// on without one.

// Each attempt is its own read-context change: reads stay unavailable while
// any attempt is open, the first node's and a replacement's overlapping too.
const attemptNode = async (nodeUrl) => {
  const finishReadChange = beginReadContextChange();
  try {
    // Inside the try: remembering the node is optional, and a storage failure
    // here must not undo an unlock that has already been adopted.
    setCurrentNodeUrl(nodeUrl);
    await Zenon.getSingleton().initialize(nodeUrl, false, 8000);
    return true;
  } catch (err) {
    return false;
  } finally {
    finishReadChange();
  }
};

// The connection an unlock is waiting on, or null.
let pending = null;

const connectToNode = (dispatch, isCurrent = () => true) => new Promise((resolve) => {
  const nodeUrl = getCurrentNodeUrl() || defaultNodeUrl;
  dispatch(storeNodeUrl(nodeUrl));
  const wait = {
    nodeUrl,
    replaced: false,
    done: false,
    finish(ok) {
      if (wait.done) return;
      wait.done = true;
      if (pending === wait) pending = null;
      if (isCurrent()) dispatch(storeIsConnected(ok));
      resolve(ok);
    },
  };
  pending = wait;
  attemptNode(nodeUrl).then((ok) => {
    // A node someone moved away from has no say. One the unlock stopped
    // waiting for may still come up, and the header should then say so.
    if (wait.replaced) return;
    if (wait.done) {
      if (ok && isCurrent()) dispatch(storeIsConnected(true));
      return;
    }
    wait.finish(ok);
  });
});

// Which node an unlock is waiting on, or null when none is.
const waitingForNode = () => (pending && !pending.done ? pending.nodeUrl : null);

// Tries `nodeUrl` in place of the node the unlock is waiting on. On success
// the unlock goes on, connected to it; on failure it keeps waiting, so the
// screen can offer another node or `stopWaitingForNode`.
const replaceWaitingNode = async (dispatch, nodeUrl) => {
  const wait = pending;
  if (!wait || wait.done) return false;
  wait.replaced = true;
  wait.nodeUrl = nodeUrl;
  dispatch(storeNodeUrl(nodeUrl));
  Zenon.getSingleton().clearSocketConnection();
  const ok = await attemptNode(nodeUrl);
  if (ok) wait.finish(true);
  return ok;
};

// Carries on without a node. The header reports it, and Settings → Node is
// then a tap away.
const stopWaitingForNode = () => pending?.finish(false);

const probeMs = 2500;

const answers = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  Promise.resolve()
    .then(() => Zenon.getSingleton().ledger.getFrontierMomentum())
    .then(() => resolve(true), () => resolve(false))
    .finally(() => clearTimeout(timer));
});

const dropSocket = () => {
  const zenon = Zenon.getSingleton();
  const rpc = zenon.wsClient?._wsRpc2Client;
  [() => rpc?.setAutoReconnect?.(false), () => rpc?.close?.(), () => zenon.clearSocketConnection()]
    .forEach((step) => { try { step(); } catch (error) { return; } });
  const queue = rpc?.queue;
  if (!queue || typeof queue !== 'object') return;
  Object.keys(queue).forEach((id) => {
    const entry = queue[id];
    delete queue[id];
    clearTimeout(entry?.timeout);
    try { entry?.promise?.[1]?.(fail(108)); } catch (error) { return; }
  });
};

let checking = null;

const connecting = () => (pending && !pending.done) || readContextChanging();

const checkNode = (dispatch, isCurrent = () => true, { probe = true } = {}) => {
  if (connecting()) return Promise.resolve(null);
  if (checking) return checking;
  // A node change may finish while a probe or reconnection is awaited.
  const isCurrentRpc = (rpc) => !connecting() && isCurrent() &&
    Zenon.getSingleton().wsClient?._wsRpc2Client === rpc;
  checking = (async () => {
    const rpc = Zenon.getSingleton().wsClient?._wsRpc2Client;
    const healthy = rpc?.ready && (!probe || await answers(probeMs));
    if (!isCurrentRpc(rpc)) return null;
    if (healthy) {
      dispatch(storeIsConnected(true));
      return true;
    }
    dispatch(storeIsConnected(false));
    const nodeUrl = getCurrentNodeUrl() || defaultNodeUrl;
    dropSocket();
    const attempt = attemptNode(nodeUrl);
    const replacementRpc = Zenon.getSingleton().wsClient?._wsRpc2Client;
    const ok = await attempt;
    if (!isCurrentRpc(replacementRpc)) return null;
    dispatch(storeIsConnected(ok));
    return ok;
  })().finally(() => { checking = null; });
  return checking;
};

// Restore carries the original lease identity; only a password creates a new
// one. Slow address/node work cannot re-publish a revoked unlock.
const completeUnlock = async ({ walletName, password, sessionRecord, dispatch }) => {
  const addressInfo = getAddressInfo(walletName);
  // Recorded once the password (or session) has checked out — a wrong guess
  // must never become the screen's next default — and before the keys are
  // adopted, so a failed write leaves nothing half unlocked.
  const prepare = () => setLastWalletName(walletName);
  // A resumed session keeps the account it was on; the shared selection, not
  // this window's saved default, is what sites and approvals are bound to.
  const index = sessionRecord ? sessionRecord.scope?.index : addressInfo.selectedAddressIndex;
  const lifetime = sessionRecord
    ? await vault.restore(sessionRecord, prepare)
    : await vault.unlockWithPassword(walletName, password, index, prepare);
  const address = await vault.getAddress(index, lifetime);
  await vault.assertSession(lifetime);
  dispatch(walletUnlocked({
    walletName, address,
    selectedAddressIndex: index,
    // A saved selection past the saved count would draw no selected row.
    maxAddressIndex: Math.max(addressInfo.maxAddressIndex, index + 1),
  }));
  dispatch(storeChainIdentifier(Zenon.getChainIdentifier()));
  const isConnected = await connectToNode(dispatch, () => vault.isCurrent(lifetime));
  await vault.assertSession(lifetime);
  await announceUnlock(address, lifetime);
  // What the popup was showing under this lease, if it was closed while
  // unlocked (utils/popupState.js). A password unlock is a new lease: nothing.
  await loadPopupState(vault);
  return { address, isConnected };
};

export { completeUnlock, connectToNode, checkNode, waitingForNode, replaceWaitingNode, stopWaitingForNode };
