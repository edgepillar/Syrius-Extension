import { currentVersion, latestVersion, releaseState } from './release';

const dismissedKey = 'updateNoticeDismissed';
let dismissedHere = null;

const sessionArea = () => {
  try {
    return chrome.storage.session || null;
  } catch (error) {
    return null;
  }
};

const readDismissed = async () => {
  if (dismissedHere) return dismissedHere;
  const stored = await Promise.resolve()
    .then(() => sessionArea()?.get(dismissedKey))
    .catch(() => null);
  return stored?.[dismissedKey] ?? null;
};

const pendingUpdate = async ({ latest = latestVersion, current = currentVersion } = {}) => {
  const found = await latest();
  if (releaseState(found, current()) !== 'update') return null;
  return (await readDismissed()) === found ? null : found;
};

const dismissUpdate = async (version) => {
  dismissedHere = version;
  await Promise.resolve()
    .then(() => sessionArea()?.set({ [dismissedKey]: version }))
    .catch(() => {});
};

export { dismissedKey, pendingUpdate, dismissUpdate };
