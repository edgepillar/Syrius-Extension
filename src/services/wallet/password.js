import { KeyFile, KeyStoreManager } from 'znn-ts-sdk';

const passwordCriteria =
  'Use at least 8 characters with a lowercase letter, an uppercase letter, a digit, and one of !@#$%^&*.';
const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=.{8,})/;

// React Hook Form requires true or a string error; JSX is not a validation error.
const validateWalletPassword = (password) =>
  typeof password === 'string' && strongPassword.test(password) ? true : passwordCriteria;

// Only new passwords are subject to this policy. Existing passwords must still
// work for unlocking, rotation, recovery-phrase export, and wallet removal.
const saveWalletWithPassword = async (keyStore, password, walletName) => {
  const validation = validateWalletPassword(password);
  if (validation !== true) {
    throw new Error(validation);
  }
  // The pinned manager's async Promise executor can leave encryption errors
  // unsettled. Await the same SDK encryption directly before any disk write.
  const manager = new KeyStoreManager();
  const name = walletName && typeof walletName === 'string'
    ? walletName.replace(' ', '-')
    : (await keyStore.getKeyPair().getAddress()).toString();
  const encrypted = await KeyFile.encrypt(keyStore, password);
  if (!encrypted || typeof encrypted !== 'object' || Array.isArray(encrypted)) {
    throw new Error('Encrypted wallet data could not be created safely. No wallet was saved.');
  }
  const wallets = manager.listAllKeyStores();
  if (!wallets || typeof wallets !== 'object' || Array.isArray(wallets)) {
    throw new Error('Saved wallet data could not be read safely. No wallet was saved.');
  }
  // Match StorageController's raw KeyFile serialization and storage key. This
  // does not add a cross-window name-ownership or writer transaction protocol.
  Object.defineProperty(wallets, name, { value: encrypted, enumerable: true, configurable: true, writable: true });
  localStorage.setItem(manager.walletPath, JSON.stringify(wallets));
  return manager.walletPath + name;
};

export { passwordCriteria, validateWalletPassword, saveWalletWithPassword };
