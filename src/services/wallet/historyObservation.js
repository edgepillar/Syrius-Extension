import { captureReadContext } from './readContext';

// This is a display/reconciliation context, not proof of chain identity.
const validNetwork = (network) => Boolean(network && Number.isSafeInteger(network.chainIdentifier) &&
  network.chainIdentifier > 0 && typeof network.nodeUrl === 'string' && network.nodeUrl);
const sameHistoryNetwork = (left, right) => validNetwork(left) && validNetwork(right) &&
  left.chainIdentifier === right.chainIdentifier && left.nodeUrl === right.nodeUrl;

// Keep live client references out of Redux. A reconnect, even to the same URL,
// invalidates an outstanding observation rather than giving it newer authority.
const captureHistoryNetwork = (zenon) => {
  const { network, isCurrent } = captureReadContext(zenon);
  return { network, isCurrent };
};

export { captureHistoryNetwork, sameHistoryNetwork };
