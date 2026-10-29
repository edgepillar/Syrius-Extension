import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import Dashboard from '../../pages/dashboard/dashboard/dashboard';
import Tokens from '../../pages/tokens/tokens';
import Delegate from '../../pages/delegate/delegate';
import Plasma from '../../pages/plasma/plasma';
import Stake from '../../pages/staking/stake/stake';
import Send from '../../pages/send-receive/send/send';
import Receive from '../../pages/send-receive/receive/receive';

import MenuHeader from '../../pages/menu/menu-header/menu-header';
import MenuTabs from '../../pages/menu/menu-tabs/menu-tabs';
import OutgoingWatch from '../../components/outgoing-watch/outgoing-watch';
import JournalNotice from '../../components/journal-notice/journal-notice';
import AppWatch from '../../components/app-watch/app-watch';
import BackgroundReceive from '../../components/background-receive/background-receive';
import BlockSync from '../../components/block-sync/block-sync';
import NodeWatch from '../../components/node-watch/node-watch';
import { saveRoute } from '../../services/utils/popupState';

import Settings from '../../pages/settings/settings/settings';
import ChangeNode from '../../pages/settings/change-node/change-node';
import ExportMnemonic from '../../pages/settings/export-mnemonic/export-mnemonic';
import ChangeAddress from '../../pages/settings/change-address/change-address';
import ChangePassword from '../../pages/settings/change-password/change-password';
import Biometric from '../../pages/settings/biometric/biometric';
import Contacts from '../../pages/settings/contacts/contacts';
import ConnectedSites from '../../pages/settings/connected-sites/connected-sites';
import SignMessage from '../../pages/settings/sign-message/sign-message';
import ResetWallet from '../../pages/settings/reset-wallet/reset-wallet';
import Sporks from '../../pages/settings/sporks/sporks';
import Zap from '../../pages/settings/zap/zap';
import Sentinel from '../../pages/sentinel/sentinel';
import NodeStats from '../../pages/settings/node-stats/node-stats';
import About from '../../pages/settings/about/about';
import Pillar from '../../pages/pillar/pillar';
import PillarForm from '../../pages/pillar/pillar-form';
import Rewards from '../../pages/pillar/rewards';
import Az from '../../pages/pillar/az';
import AzForm from '../../pages/pillar/az-form';
import TokenManage from '../../pages/tokens/token-manage';
import TokenIssue from '../../pages/tokens/token-issue';
import TokenDetail from '../../pages/tokens/token-detail';
import { biometricName } from '../../services/utils/app';

// Which screens are somewhere you go into, rather than somewhere you are. Those
// get a back button and no bottom bar — a tab bar on a sub-screen invites you to
// leave without finishing what you opened it for.
const subScreens = {
  '/tabs/dashboard/send': 'Send',
  '/tabs/dashboard/receive': 'Receive',
  '/tabs/change-address': 'Addresses',
  '/tabs/settings': 'Settings',
  '/tabs/settings/change-node': 'Node',
  '/tabs/settings/export-mnemonic': 'Backup phrase',
  '/tabs/settings/change-password': 'Password',
  // Fingerprint, Face ID or Touch ID, as the phone calls it.
  get '/tabs/settings/biometric'() { return `${biometricName()} unlock`; },
  '/tabs/settings/contacts': 'Address book',
  '/tabs/settings/connected-sites': 'Connected sites',
  '/tabs/settings/sign-message': 'Sign message',
  '/tabs/settings/reset-wallet': 'Remove wallet',
  '/tabs/settings/sporks': 'Sporks',
  '/tabs/settings/zap': 'Zap',
  '/tabs/sentinel': 'Sentinel',
  '/tabs/settings/node-stats': 'Node stats',
  '/tabs/settings/about': 'About',
  '/tabs/tokens/manage': 'Your tokens',
  '/tabs/tokens/issue': 'Issue token',
  '/tabs/tokens/token': 'Token',
  '/tabs/pillar/register': 'Register pillar',
  '/tabs/pillar/update': 'Update pillar',
  '/tabs/az/new': 'New project',
  '/tabs/az/phase': 'Phase',
};

const TabsLayout = () => {
  const location = useLocation();
  const subScreenTitle = subScreens[location.pathname];
  // Reopened here if the popup closes (utils/popupState.js).
  useEffect(() => {
    saveRoute(location.pathname, location.state, window.history.state?.idx);
  }, [location.key, location.pathname, location.state]);
  // In the app, syrius:// links wait for these screens: they mean the wallet
  // is unlocked (platform/appLinks.js).
  useEffect(() => {
    window.syriusAppLinks?.setReady(true);
    return () => window.syriusAppLinks?.setReady(false);
  }, []);
  const address = useSelector((state) => state.wallet.address);
  // A row appearing, settling or failing is each a reason to look again now
  // rather than at the next poll.
  const inFlight = useSelector((state) => state.pendingTransactions.items.map((item) => item.status).join());

  return (
    <div className="tabs-layout">
      <MenuHeader backButton={Boolean(subScreenTitle)} title={subScreenTitle || ''} />

      <main className="menu-layout">
        {/* Here rather than on the dashboard: a block whose outcome is unknown
            holds up sending from every screen, and it is settled from
            whichever one happens to be open. */}
        <JournalNotice address={address} refreshKey={inFlight} />
        <Routes location={location}>
          <Route index element={<Navigate to="/tabs/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="dashboard/send" element={<Send />} />
          <Route path="dashboard/receive" element={<Receive />} />

          <Route path="tokens" element={<Tokens />} />
          <Route path="tokens/manage" element={<TokenManage />} />
          <Route path="tokens/issue" element={<TokenIssue />} />
          <Route path="tokens/token" element={<TokenDetail />} />
          <Route path="delegate" element={<Delegate />} />
          <Route path="plasma" element={<Plasma />} />
          <Route path="stake" element={<Stake />} />

          <Route path="change-address" element={<ChangeAddress />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/change-node" element={<ChangeNode />} />
          <Route path="settings/export-mnemonic" element={<ExportMnemonic />} />
          <Route path="settings/change-password" element={<ChangePassword />} />
          <Route path="settings/biometric" element={<Biometric />} />
          <Route path="settings/contacts" element={<Contacts />} />
          <Route path="settings/connected-sites" element={<ConnectedSites />} />
          <Route path="settings/sign-message" element={<SignMessage />} />
          <Route path="settings/reset-wallet" element={<ResetWallet />} />
          <Route path="settings/sporks" element={<Sporks />} />
          <Route path="settings/zap" element={<Zap />} />
          <Route path="sentinel" element={<Sentinel />} />
          <Route path="settings/node-stats" element={<NodeStats />} />
          <Route path="settings/about" element={<About />} />

          {/* Pillar mode (Settings). The routes exist either way; the mode
              only decides whether the menus offer them. */}
          <Route path="pillar" element={<Pillar />} />
          <Route path="pillar/register" element={<PillarForm mode="register" />} />
          <Route path="pillar/update" element={<PillarForm mode="update" />} />
          <Route path="rewards" element={<Rewards />} />
          <Route path="az" element={<Az />} />
          <Route path="az/new" element={<AzForm mode="new" />} />
          <Route path="az/phase" element={<AzForm mode="phase" />} />
        </Routes>
      </main>

      {/* Follows sent blocks on every screen; peeks up above the tab bar
          away from Home. */}
      <OutgoingWatch />
      <AppWatch />
      <BackgroundReceive />
      <BlockSync />
      <NodeWatch />
      {!subScreenTitle && <MenuTabs />}
    </div>
  );
};

export default TabsLayout;
