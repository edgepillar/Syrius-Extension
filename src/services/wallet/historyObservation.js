import { Zenon } from 'znn-ts-sdk';
import { getCurrentNodeUrl } from '../utils/storage';

// This is a display/reconciliation context, not proof of chain identity.
const validNetwork = (network) => Boolean(network && Number.isSafeInteger(network.chainIdentifier) &&
  network.chainIdentifier > 0 && typeof network.nodeUrl === 'string' && network.nodeUrl);
const sameHistoryNetwork = (left, right) => validNetwork(left) && validNetwork(right) &&
  left.chainIdentifier === right.chainIdentifier && left.nodeUrl === right.nodeUrl;

// Keep live client references out of Redux. A reconnect, even to the same URL,
// invalidates an outstanding observation rather than giving it newer authority.
const captureHistoryNetwork = (zenon) => {
  const network = Object.freeze({ chainIdentifier: Zenon.getChainIdentifier(), nodeUrl: getCurrentNodeUrl() });
  const client = zenon.ledger.client;
  const socket = zenon.wsClient;
  const isCurrent = () => {
    try {
      return sameHistoryNetwork(network, {
        chainIdentifier: Zenon.getChainIdentifier(), nodeUrl: getCurrentNodeUrl(),
      }) && Zenon.getSingleton() === zenon && zenon.ledger.client === client && zenon.wsClient === socket;
    } catch (error) {
      // Context-read failure must not turn a node-accepted block into failure.
      return false;
    }
  };
  return { network, isCurrent };
};

export { captureHistoryNetwork, sameHistoryNetwork };
