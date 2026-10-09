'use strict';
// Optional native-browser check of the actual modal, alert and state hook.
// All callbacks are inert counters; no wallet, SDK or network endpoint is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const webpack = require('webpack');
const sass = require('sass');
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-modal-focus-'));
const extension = path.join(dir, 'extension');
const profile = path.join(dir, 'profile');
fs.mkdirSync(extension);
const files = [
  'src/services/hooks/modal/modal.js',
  'src/services/hooks/modal/modalContext.js',
  'src/services/hooks/modal/useModal.js',
  'src/components/modals/alert-modal.js',
  'src/assets/close-icon.svg',
];
for (const file of files) {
  const output = path.join(extension, file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(root, file), output);
}
fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Isolated modal focus checks', version: '1.0',
  content_security_policy: JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'))).content_security_policy,
}));
fs.writeFileSync(path.join(extension, 'popup.css'), sass.compile(path.join(root, 'src/sections/Popup/Popup.scss')).css);
fs.writeFileSync(path.join(extension, 'page.html'), '<!doctype html><meta charset="utf-8"><title>Isolated modal focus checks</title><link rel="stylesheet" href="popup.css"><body class="standalone-window"><button id="trigger">Open dialog</button><button id="background">Background action</button><div id="fixture-root"></div><div id="modal-root"></div><script src="fixture.js"></script></body>');
fs.writeFileSync(path.join(extension, 'entry.jsx'), `
import React, {useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import Modal from './src/services/hooks/modal/modal';
import {ModalContext} from './src/services/hooks/modal/modalContext';
import useModal from './src/services/hooks/modal/useModal';
import AlertModal from './src/components/modals/alert-modal';
const counts={closed:0,dismissed:0,confirmed:0,background:0};
window.fixture={counts};
const Fixture=()=>{
  const model=useModal();
  const close=useCallback(()=>{counts.closed++;model.closeModal();},[model.closeModal]);
  const alert=title=><AlertModal title={title} onDismiss={()=>counts.dismissed++} onSuccess={()=>counts.confirmed++}><p>Review this synthetic action before choosing.</p></AlertModal>;
  const show=(kind='alert',title='Confirm this synthetic action')=>{
    if(kind==='generic')model.openModal(<div>Read this synthetic message.</div>);
    else if(kind==='single')model.openModal(<div title={title}><button id="single-action" onClick={()=>counts.confirmed++}>Confirm</button></div>);
    else if(kind==='disabled')model.openModal(<div title={title}><button disabled>Disabled</button><button hidden>Hidden</button><fieldset disabled><button>Disabled by fieldset</button></fieldset><span inert=""><button>Inert</button></span><button style={{visibility:'hidden'}}>Invisible</button></div>);
    else model.openModal(alert(title));
  };
  Object.assign(window.fixture,{show,replace:()=>model.openModal(alert('Replacement synthetic action'))});
  return <ModalContext.Provider value={{...model,closeModal:close}}><Modal /></ModalContext.Provider>;
};
const reactRoot=createRoot(document.querySelector('#fixture-root'));
reactRoot.render(<Fixture />);
fixture.unmount=()=>reactRoot.unmount();
document.querySelector('#trigger').onclick=()=>fixture.show();
document.querySelector('#background').onclick=()=>counts.background++;
`);
let browser, socket, cdp, finished;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const compile = () => new Promise((resolve, reject) => {
  const compiler = webpack({
    mode: 'production', context: extension, entry: path.join(extension, 'entry.jsx'),
    output: { path: extension, filename: 'fixture.js' }, devtool: false,
    resolve: { modules: [path.join(root, 'node_modules')] },
    module: { rules: [
      { test: /\.jsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-react')], configFile: false, babelrc: false } } },
      { test: /\.svg$/, type: 'asset/resource' },
    ] }, performance: false,
  });
  compiler.run((error, stats) => compiler.close(() => {
    if (error || stats.hasErrors()) reject(new Error('The isolated modal fixture failed to compile.'));
    else resolve();
  }));
});
const watchdog = setTimeout(() => {
  console.error('Native modal focus checks timed out.');
  socket?.close(); browser?.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1);
}, 120000);
(async () => {
  await compile();
  browser = spawn(process.env.CHROMIUM_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--enable-unsafe-extension-debugging', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError; browser.on('error', () => { launchError = new Error('The requested browser could not be started.'); }); browser.stderr.resume();
  let port;
  for (let i = 0; i < 200; i++) {
    if (launchError) throw launchError;
    const file = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(file)) { port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); break; }
    await pause(50);
  }
  assert(port, 'The disposable browser started.');
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(Error('The local browser debugging connection failed.')); });
  let id = 0; const pending = new Map(); let runtimeErrors = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data), call = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors++;
    if (call) { pending.delete(message.id); message.error ? call.reject(Error('A browser protocol operation failed.')) : call.resolve(message.result); }
  };
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const loaded = await cdp('Extensions.loadUnpacked', { path: extension });
  const target = await cdp('Target.createTarget', { url: 'chrome-extension://' + loaded.id + '/page.html' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 400, deviceScaleFactor: 1, mobile: false }, sessionId);
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error('An isolated modal fixture operation failed.');
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(20); }
    throw Error('The expected modal state did not appear.');
  };
  const key = async (value, shift = false) => {
    const code = value === 'Tab' ? 9 : value === 'Escape' ? 27 : 13;
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0, ...(value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, sessionId);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }, sessionId);
  };
  const active = () => evaluate("document.activeElement.id || document.activeElement.className");
  const show = async (kind = 'alert', title) => {
    await evaluate(`document.querySelector('#trigger').focus();fixture.show(${JSON.stringify(kind)},${JSON.stringify(title)})`);
    await until("Boolean(document.querySelector('[role=dialog]'))");
  };
  const closed = async () => { await until("!document.querySelector('[role=dialog]')"); assert.equal(await active(), 'trigger'); };
  const counts = () => evaluate('fixture.counts');
  await until("typeof window.fixture?.show === 'function'");
  await evaluate("document.querySelector('#trigger').focus()");
  await key('Enter');
  await until("Boolean(document.querySelector('[role=dialog]'))");
  if (process.argv.includes('--expect-baseline')) {
    assert.equal(await active(), 'trigger');
    assert.equal(await evaluate("document.querySelector('[role=dialog]').getAttribute('aria-label')"), null);
    await key('Tab'); assert.equal(await active(), 'background');
    finished = { baseline: true, node: process.version, browser: version.Browser, initialFocusOutsideDialog: true, tabEscapesToBackground: true, dialogNameAbsent: true };
    return;
  }
  assert.equal(await active(), 'close-modal');
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getAttribute('aria-label')"), 'Confirm this synthetic action');
  const fits = await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()");
  assert.equal(fits, true);
  await cdp('DOM.enable', {}, sessionId);
  const { root: documentRoot } = await cdp('DOM.getDocument', {}, sessionId);
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '[role=dialog]' }, sessionId);
  const { nodes } = await cdp('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }, sessionId);
  assert(nodes.some(node => node.role?.value === 'dialog' && node.name?.value === 'Confirm this synthetic action'));
  await key('Tab'); assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Cancel');
  await key('Tab'); assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Confirm');
  await key('Tab'); assert.equal(await active(), 'close-modal');
  await key('Tab', true); assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Confirm');
  await evaluate("document.querySelector('#background').focus()"); assert.equal(await active(), 'close-modal');
  await key('Escape'); await closed(); assert.deepEqual(await counts(), { closed: 1, dismissed: 0, confirmed: 0, background: 0 });
  await show();
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 }, sessionId);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 }, sessionId);
  await closed(); assert.deepEqual(await counts(), { closed: 2, dismissed: 0, confirmed: 0, background: 0 });
  await show(); await key('Enter'); await closed();
  assert.deepEqual(await counts(), { closed: 3, dismissed: 1, confirmed: 0, background: 0 });
  await show(); await key('Tab'); await key('Enter'); await closed();
  assert.deepEqual(await counts(), { closed: 4, dismissed: 2, confirmed: 0, background: 0 });
  await show(); await key('Tab'); await key('Tab'); await key('Enter'); await closed();
  assert.deepEqual(await counts(), { closed: 5, dismissed: 2, confirmed: 1, background: 0 });
  await show(); await key('Tab'); await key('Tab'); await evaluate('fixture.replace()');
  await until("document.querySelector('[role=dialog]').getAttribute('aria-label') === 'Replacement synthetic action'");
  assert.equal(await active(), 'close-modal'); await key('Escape'); await closed();
  await show('generic'); assert.equal(await active(), 'modal-container text-white');
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getAttribute('aria-label')"), 'Wallet dialog');
  await key('Tab'); assert.equal(await active(), 'modal-container text-white');
  await key('Tab', true); assert.equal(await active(), 'modal-container text-white');
  await key('Escape'); await closed();
  await show('single', 'Single synthetic action'); assert.equal(await active(), 'modal-container text-white');
  await key('Enter'); assert.equal((await counts()).confirmed, 1);
  await key('Tab'); assert.equal(await active(), 'single-action');
  await key('Tab'); assert.equal(await active(), 'single-action');
  await key('Tab', true); assert.equal(await active(), 'single-action');
  await key('Escape'); await closed();
  await show('disabled', '   '); assert.equal(await active(), 'modal-container text-white');
  assert.equal(await evaluate("document.querySelector('[role=dialog]').getAttribute('aria-label')"), 'Wallet dialog');
  await key('Tab'); assert.equal(await active(), 'modal-container text-white');
  await key('Tab', true); assert.equal(await active(), 'modal-container text-white');
  await key('Escape'); await closed();
  await show();
  await evaluate("document.querySelector('.close-modal').disabled=true;document.querySelector('#background').focus()");
  assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Cancel');
  await key('Tab', true); assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Confirm');
  await key('Escape'); await closed();
  await show(); await evaluate("document.querySelector('#trigger').remove()"); await key('Escape');
  await until("!document.querySelector('[role=dialog]')");
  assert.equal(await evaluate('document.activeElement.tagName'), 'BODY');
  await evaluate("document.querySelector('#background').focus();fixture.show()");
  await until("Boolean(document.querySelector('[role=dialog]'))");
  await evaluate('fixture.unmount()'); await until("!document.querySelector('[role=dialog]')");
  assert.equal(await active(), 'background');
  assert.equal(runtimeErrors, 0); assert.equal((await counts()).background, 0);
  finished = { baseline: false, node: process.version, browser: version.Browser, actualModalComponentsAndStateHook: true,
    nativeDialogAccessibleName: true, dismissalFirstFocus: true, tabAndShiftTabContained: true, backgroundFocusRedirected: true,
    escapeAndBackdropPreserveCloseOnlySemantics: true, closeCancelConfirmCallbacksOnce: true,
    originalTriggerRestoredAfterContentReplacement: true, noFocusableAndDisabledContentContained: true,
    initialEnterDoesNotConfirmSingleAction: true, detachedTriggerHandled: true, unmountRestoresConnectedTrigger: true,
    simpleDialogFits360x400: true, runtimeErrors };
})().catch(error => { console.error(error.message || 'Native modal focus checks failed.'); process.exitCode = 1; }).finally(async () => {
  if (cdp) await cdp('Browser.close').catch(() => {});
  socket?.close(); browser?.kill();
  if (browser) await Promise.race([new Promise(resolve => {
    if (browser.exitCode !== null) return resolve(); browser.once('exit', resolve);
  }), pause(2000)]);
  fs.rmSync(dir, { recursive: true, force: true }); clearTimeout(watchdog);
  if (finished) console.log(JSON.stringify({ ...finished, disposableProfileRemoved: !fs.existsSync(dir) }));
});
