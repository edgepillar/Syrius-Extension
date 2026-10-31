import { useEffect } from 'react';
import { startBackgroundReceive } from '../../services/wallet/backgroundReceive';
import { emitChainChange } from '../../services/wallet/chainEvents';
import { markAccountStale } from '../../services/hooks/useAccount';
import { hostReady } from '../../services/wallet/blockService';

// Receives incoming blocks every 30 s while the tab screens are up, on every
// screen, not only Home (wallet/backgroundReceive.js), with the popup's and
// the app's own vault, as unlocked. Only when there is no background page to
// do it (wallet/blockService.js): On close, and the app. Renders nothing.
const BackgroundReceive = () => {
  useEffect(() => startBackgroundReceive({
    ready: async () => !(await hostReady()),
    onReceived: () => {
      markAccountStale();
      emitChainChange('received');
    },
  }), []);
  return null;
};

export default BackgroundReceive;
