import { KeyStore, KeyStoreManager, Zenon } from 'znn-ts-sdk';
import { retireReadContext } from '../wallet/readContext';
import { getAddressInfo, setAddressInfo } from './storage';

// Where `utils/dev-harness.js` leaves the wallet it wants unlocked. The harness
// writes it into the extension's own localStorage over the debugging protocol
// before the popup boots, so no password and no key is ever compiled into a
// bundle - what is compiled in is only the willingness to read this key.
const devWalletConfigKey = 'znn.dev-autounlock';

// Two locks, and both have to be open. A build has to opt in through
// SYRIUS_DEV_WALLET, which only the dev harness sets, and no production build
// can satisfy the second half. With either one shut, everything below folds to
// a constant `false` and webpack drops the branch.
const isDevWalletBuild =
  process.env.SYRIUS_DEV_WALLET === 'true' && process.env.NODE_ENV !== 'production';

const readDevWalletConfig = () => {
  if (!isDevWalletBuild) {
    return null;
  }

  try {
    const config = JSON.parse(localStorage.getItem(devWalletConfigKey) || 'null');

    if (!config || !config.walletName || !config.password) {
      return null;
    }
    return config;
  }
  catch (err) {
    console.error("Dev harness: could not read the auto-unlock config ", err);
    return null;
  }
}

// Puts the harness' wallet and node into storage so the password screen can
// unlock itself. Safe to call on every start: the keystore is only written the
// first time a browser profile sees it, and the wallet is generated in the
// profile unless a mnemonic was handed over on purpose.
const prepareDevWallet = async () => {
  const config = readDevWalletConfig();

  if (!config) {
    return null;
  }

  try {
    const keyManager = new KeyStoreManager();

    if (!keyManager.listAllKeyStores()[config.walletName]) {
      console.warn("Dev harness: creating the auto-unlock wallet " + config.walletName);

      if (config.mnemonic) {
        await keyManager.saveKeyStore(new KeyStore().fromMnemonic(config.mnemonic), config.password, config.walletName);
      }
      else {
        await keyManager.createNew(config.password, config.walletName);
      }
    }

    if (config.nodeUrl) {
      retireReadContext();
      localStorage.setItem("currentNodeUrl", config.nodeUrl);
    }

    if (config.chainId) {
      retireReadContext();
      Zenon.setChainIdentifier(config.chainId);
    }

    // The first address of a devnet mnemonic is usually a producer key with an
    // empty balance, so the harness gets to say which one it wants to land on.
    if (Number.isInteger(config.addressIndex)) {
      const known = getAddressInfo(config.walletName);

      setAddressInfo(config.walletName, {
        selectedAddressIndex: config.addressIndex,
        maxAddressIndex: Math.max(known.maxAddressIndex || 1, config.addressIndex + 1),
      });
    }

    return config;
  }
  catch (err) {
    console.error("Dev harness: could not prepare the wallet ", err);
    return null;
  }
}

export { isDevWalletBuild, readDevWalletConfig, prepareDevWallet };
