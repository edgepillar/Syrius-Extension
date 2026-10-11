import { Zenon } from 'znn-ts-sdk';
import { getCurrentNodeUrl } from '../utils/storage';

// Read/display lifetime only. A new opaque identity also retires an A -> B -> A
// transition; endpoint equality does not make an earlier RPC current again.
let current;
let notificationPending = false;
const listeners = new Set();
const transitions = new Set();
const observedRpc = new WeakSet();
const notify = () => {
  if (notificationPending) return;
  notificationPending = true;
  Promise.resolve().then(() => {
    notificationPending = false;
    listeners.forEach((listener) => {
      try { listener(); } catch (error) { /* One view cannot block other views from retiring. */ }
    });
  });
};
const retireReadContext = () => { current = null; notify(); };
const subscribeReadContext = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
// Explicit initialize/clear operations may replace clients before their promise
// settles. Keep reads unavailable throughout overlapping connection changes.
const beginReadContextChange = () => {
  const transition = {};
  transitions.add(transition);
  retireReadContext();
  return () => {
    if (transitions.delete(transition)) retireReadContext();
  };
};
const observeRpc = (rpc) => {
  if (!rpc || typeof rpc.on !== 'function') return true;
  if (observedRpc.has(rpc)) return true;
  const changed = () => {
    try {
      const zenon = Zenon.getSingleton();
      if (zenon.wsClient?._wsRpc2Client === rpc || zenon.ledger.client?._wsRpc2Client === rpc) retireReadContext();
    } catch (error) { retireReadContext(); }
  };
  // The pinned SDK's RPC emitter reconnects inside the same WsClient and RPC
  // object. Its close/open events retire even a reused transport identity.
  try {
    rpc.on('close', changed);
    rpc.on('open', changed);
    observedRpc.add(rpc);
    return true;
  } catch (error) { return false; }
};
const read = () => {
  try {
    const zenon = Zenon.getSingleton();
    const client = zenon.ledger.client;
    const socket = zenon.wsClient;
    const rpc = socket?._wsRpc2Client;
    const endpoint = socket?.url;
    const rpcEndpoint = rpc?.address;
    const chainIdentifier = Zenon.getChainIdentifier();
    const nodeUrl = getCurrentNodeUrl();
    const observable = observeRpc(rpc);
    // Shared storage may have been changed by another document, or before a
    // failed connection's fallback. Do not label an old socket with that URL.
    return { zenon, client, socket, rpc, endpoint, rpcEndpoint, transport: rpc?.socket, ready: rpc?.ready,
      chainIdentifier, nodeUrl, available: transitions.size === 0 && observable && Boolean(client && socket) &&
        Number.isSafeInteger(chainIdentifier) && chainIdentifier > 0 && typeof nodeUrl === 'string' && Boolean(nodeUrl) &&
        client === socket && endpoint === nodeUrl && (!rpc || (rpc.ready === true && rpcEndpoint === nodeUrl)) };
  } catch (error) { return { available: false }; }
};
const captureReadContext = (expectedZenon) => {
  const values = read();
  if (!current || Object.keys(values).some((key) => values[key] !== current.values[key]) ||
      Object.keys(current.values).some((key) => values[key] !== current.values[key])) {
    current = { key: Object.freeze({}), values };
    notify();
  }
  const captured = current;
  if (!captured.context) {
    const { zenon, chainIdentifier, nodeUrl, available } = values;
    captured.context = { key: captured.key, zenon, available,
      network: Object.freeze({ chainIdentifier, nodeUrl }),
      isCurrent: () => {
        const latest = captureReadContext();
        return available && latest.available && latest.key === captured.key;
      } };
  }
  return expectedZenon ? { ...captured.context,
    isCurrent: () => expectedZenon === captured.context.zenon && captured.context.isCurrent(),
  } : captured.context;
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || ['currentNodeUrl', 'znn.ts-chainId'].includes(event.key)) retireReadContext();
  });
}

export { captureReadContext, subscribeReadContext, retireReadContext, beginReadContextChange };
