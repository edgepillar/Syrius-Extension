import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Icon from '../../../components/icon/icon';
import SettingsItem from '../../../components/settings-item/settings-item';
import { getSettings } from '../../../services/utils/storage';
import { updateSetting } from '../../../services/wallet/preferences';
import lease from '../../../services/wallet/sessionLease';
import { notify } from '../../../services/utils/notify';
import { explorerChoices } from '../../../services/utils/explorer';
import { applyTheme, themeChoices } from '../../../services/utils/theme';
import { modes } from '../../../services/utils/menu';
import app, { biometricIcon, biometricName } from '../../../services/utils/app';

// The settings index.
//
// It listed two items and carried a commented-out third with a "ToDo: Add
// change password functionality" note against it. Changing a wallet password
// and removing a wallet are both things desktop Syrius has always had, and the
// absence of the second one meant there was no way to get a wallet off a shared
// machine from inside the extension at all.
//
// A row says what it sets and no more. Each used to carry a sentence under its
// title repeating the title; the one note left is on pillar mode, which is the
// only switch here whose name does not say what it changes.

const autoLockChoices = [
  { minutes: 5, label: '5 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: lease.never, label: 'Never' },
  { minutes: 0, label: 'On close' },
];

// Called as a function, not mounted as a component, so the buttons sit in
// the screen's own tree (utils/session-policy-test.js renders it shallowly).
const segmented = ({ choices, value, disabled, onChange }) => (
  <div className="segmented">
    {choices.map((choice) => (
      <button
        key={choice.key}
        type="button"
        className={`segmented-option ${value === choice.key ? 'is-selected' : ''}`}
        aria-pressed={value === choice.key}
        disabled={disabled}
        onClick={() => onChange(choice.key)}
      >
        {choice.label}
      </button>
    ))}
  </div>
);

// A section that folds: its heading is the button. Modes and Wallet are
// most of this screen's height and are set once, so they start closed;
// Extension, the links and the two choices among them, starts open. Called as a function, like `segmented`, and
// the body is hidden rather than left out, so its controls stay in this
// screen's own tree.
const fold = ({ id, title, note, open, onToggle, children }) => (
  <>
    <h3 className="section-title is-fold">
      <button type="button" className="fold-toggle" aria-expanded={open} aria-controls={`settings-${id}`} onClick={onToggle}>
        <span>{title}</span>
        {note && <span className="fold-note">{note}</span>}
        <Icon name="chevron-right" size={14} className="fold-chevron" />
      </button>
    </h3>
    <div className="fold-body" id={`settings-${id}`} hidden={!open}>
      {children}
    </div>
  </>
);

// Which sections were left open, per browser profile: a convenience, not a
// setting, so it is not in the wallet's preferences.
const openKey = 'settingsOpen';
const readOpen = () => {
  try {
    const value = JSON.parse(localStorage.getItem(openKey) || '{}');
    // Extension is the section people come here for, so it is open unless
    // it was closed; the other two are closed unless they were opened.
    return { extension: value?.extension !== false, modes: value?.modes === true, wallet: value?.wallet === true };
  } catch (error) {
    return { extension: true, modes: false, wallet: false };
  }
};

const Settings = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(() => getSettings());
  const [open, setOpen] = useState(readOpen);
  const toggle = (id) => () => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    try { localStorage.setItem(openKey, JSON.stringify(next)); } catch (error) { /* stays for this visit only */ }
  };
  const modesOn = modes.filter((mode) => settings[mode.key]).length;

  const [isSaving, setIsSaving] = useState(false);
  const update = async (key, value) => {
    setIsSaving(true);
    try {
      const next = await updateSetting(key, value);
      setSettings(next);
      if (key === 'theme') applyTheme(next.theme);
    }
    catch (error) { notify.error(error); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="page">
      {/* What is about the extension itself rather than one wallet or one
          role: where it reads from, where its links go, how it looks. */}
      {fold({
        id: 'extension',
        title: 'Extension',
        open: open.extension,
        onToggle: toggle('extension'),
        children: (
      <div className="settings-group">
        <SettingsItem icon="node" title="Node" url="change-node" tone="info" />
        {/* Two choices sit among the links, where the owner wants them: which
            explorer the wallet's links open, beside the node it reads from,
            and the theme. They are rows like the others, with the choice in
            place of the chevron. */}
        <div className="settings-item is-control">
          <span className="settings-item-icon is-info">
            <Icon name="external" size={18} />
          </span>
          <span className="settings-item-title">Explorer</span>
          {segmented({
            choices: explorerChoices.map((choice) => ({ key: choice.key, label: choice.short })),
            value: settings.explorer,
            disabled: isSaving,
            onChange: (key) => update('explorer', key),
          })}
        </div>
        <SettingsItem icon="link" title="Connected sites" url="connected-sites" tone="info" />
        <SettingsItem icon="zap" title="Zap a random alien" url="zap" tone="highlight" />
        <SettingsItem icon="sign" title="Sign message" url="sign-message" />
        <SettingsItem icon="contacts" title="Address book" url="contacts" />
        <div className="settings-item is-control">
          <span className="settings-item-icon is-primary">
            <Icon name="sun" size={18} />
          </span>
          <span className="settings-item-title">Theme</span>
          {segmented({
            choices: themeChoices,
            value: settings.theme,
            disabled: isSaving,
            onChange: (key) => update('theme', key),
          })}
        </div>
        <SettingsItem icon="info" title="About" url="about" />
      </div>
        ),
      })}

      {/* Operator modes. Each adds its pages to the menus; pillar mode also
          changes the tab bar (services/utils/menu.js). */}
      {fold({
        id: 'modes',
        title: 'Modes',
        note: modesOn ? `${modesOn} on` : null,
        open: open.modes,
        onToggle: toggle('modes'),
        children: (
            <div className="settings-group">
              {modes.map((mode) => (
                <label className="mode-row" key={mode.key}>
                  <span className="setting-row-title">{mode.label}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    aria-label={`${mode.label} mode`}
                    checked={Boolean(settings[mode.key])}
                    disabled={isSaving}
                    onChange={(event) => update(mode.key, event.target.checked)}
                  />
                </label>
              ))}
            </div>
        ),
      })}

      {fold({
        id: 'wallet',
        title: 'Wallet',
        open: open.wallet,
        onToggle: toggle('wallet'),
        children: (
            <>
            {/* What belongs to this wallet alone: its phrase, its password,
                and, last, taking it off this browser. */}
            <div className="settings-group">
              <SettingsItem icon="key" title="Backup phrase" url="export-mnemonic" tone="warning" />
              <SettingsItem icon="password" title="Password" url="change-password" />
              {app() && <SettingsItem icon={biometricIcon()} title={`${biometricName()} unlock`} url="biometric" />}
            </div>

            <label className="setting-row">
              <div className="setting-row-title">Receive automatically</div>
              <input
                type="checkbox"
                className="switch"
                aria-label="Receive automatically"
                checked={settings.autoReceive}
                disabled={isSaving}
                onChange={(event) => update('autoReceive', event.target.checked)}
              />
            </label>

            <div className="setting-row">
              <div className="setting-row-title">Lock after</div>
              {segmented({
                choices: autoLockChoices.map((choice) => ({ key: choice.minutes, label: choice.label })),
                value: settings.autoLockMinutes,
                disabled: isSaving,
                onChange: (minutes) => update('autoLockMinutes', minutes),
              })}
            </div>

            <button
              type="button"
              className="button danger-text w-100"
              onClick={() => navigate('reset-wallet')}
            >
              Remove wallet
            </button>
            </>
        ),
      })}
    </div>
  );
};

export default Settings;
