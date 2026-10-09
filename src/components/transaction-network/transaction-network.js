import React from 'react';
import { useSelector } from 'react-redux';

import publicNodeUrl from '../../services/utils/publicNodeUrl';

// These are the selected settings, not proof of the node's network identity.
// Raw block review additionally names the chain carried by the prepared block.
const displayChain = value => value === undefined || value === null ? 'Unavailable'
  : typeof value === 'string' || typeof value === 'number' ? String(value) : 'Invalid chain identifier';
const TransactionNetwork = ({ chainIdentifier, nodeUrl, effectiveChainIdentifier }) => {
  const hasEffectiveChain = effectiveChainIdentifier !== undefined && effectiveChainIdentifier !== null;
  const selectedChain = displayChain(chainIdentifier), effectiveChain = displayChain(effectiveChainIdentifier);
  const mismatch = hasEffectiveChain && effectiveChain !== selectedChain;

  return (
    <>
      <dl className="confirm-details transaction-network">
        <dt>Selected signing chain</dt>
        <dd className="word-break-all">{selectedChain}</dd>
        {hasEffectiveChain && (
          <>
            <dt>Effective block chain</dt>
            <dd className="word-break-all">{effectiveChain}</dd>
          </>
        )}
        <dt>Node host</dt>
        <dd className="word-break-all">{publicNodeUrl(nodeUrl) || 'Unavailable'}</dd>
      </dl>
      {mismatch && (
        <p className="approval-warning" role="alert">
          This block uses a different chain identifier from the selected signing chain.
          Check the effective block chain before approving.
        </p>
      )}
    </>
  );
};

// Native confirmation dialogs show their current selection. This does not
// replace operation ownership or connection-generation checks in the sender.
const SelectedTransactionNetwork = () => {
  const { chainIdentifier, nodeUrl } = useSelector(state => state.connectionParameters);
  return <TransactionNetwork chainIdentifier={chainIdentifier} nodeUrl={nodeUrl} />;
};

export { SelectedTransactionNetwork };
export default TransactionNetwork;
