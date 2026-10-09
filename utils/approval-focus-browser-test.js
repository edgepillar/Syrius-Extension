// Actual approval screen/presentation/CSS with inert queue, wallet and RPC
// boundaries. No keys, wallet storage, real account or node are loaded.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const webpack = require('webpack');
const sass = require('sass');
const root = path.join(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let dir, browser, socket, cdp, result, stage = 'setup', cleaning;
const cleanup = () => cleaning ||= (async () => {
  if (cdp) await Promise.race([cdp('Browser.close').catch(() => {}), pause(1000)]);
  socket?.close(); browser?.kill();
  if (browser) await Promise.race([new Promise(resolve => {
    if (browser.exitCode !== null) return resolve(); browser.once('exit', resolve);
  }), pause(2000)]);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
})();
const interrupted = () => { process.exitCode = 1; cleanup().finally(() => process.exit(1)); };
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
const watchdog = setTimeout(interrupted, 120000);
(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-approval-focus-'));
  const extension = path.join(dir, 'extension'), profile = path.join(dir, 'profile');
  const write = (file, content) => {
    const output = path.join(extension, file);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content);
  };
  const files = [
    'src/layouts/siteIntegrationLayout/siteIntegrationLayout.js',
    'src/components/token-amount/token-amount.js',
    'src/components/transaction-network/transaction-network.js',
    'src/components/contract-call-arguments/contract-call-arguments.js',
    'src/services/wallet/tokenMetadata.js', 'src/services/utils/fallbackValues.js',
    'src/services/utils/format.js', 'src/services/utils/publicNodeUrl.js',
    'src/services/utils/approvalIdentity.js', 'src/services/utils/documentBinding.js',
    'src/services/utils/nativeNavigation.js', 'src/services/utils/errors.js',
    'src/services/utils/approvalDeadline.js',
  ];
  for (const file of files) write(file, fs.readFileSync(path.join(root, file)));
  write('manifest.json', JSON.stringify({ manifest_version: 3, name: 'Inert approval focus checks', version: '1.0',
    content_security_policy: JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'))).content_security_policy }));
  write('popup.css', sass.compile(path.join(root, 'src/sections/Popup/Popup.scss')).css);
  write('page.html', '<!doctype html><meta charset="utf-8"><title>Inert approval focus checks</title><link rel="stylesheet" href="popup.css"><body class="standalone-window"><div id="app-container"></div><script src="fixture.js"></script></body>');
  write('sdk.js', `export const Constants={};export const Primitives={TokenStandard:{parse:value=>({toString:()=>value})},Address:{parse:value=>({toString:()=>value})},AccountBlockTemplate:{send:()=>{throw Error('No transaction construction in this fixture');}}};`);
  write('src/services/hooks/useAccount.js', `export default ()=>({balanceMap:{zts1znnxxxxxxxxxxxxx9z4ulx:{balance:'9'.repeat(100)}}});`);
  write('src/services/hooks/useBlockSender.js', `export default ()=>({isSending:false,isGeneratingPlasma:false,send:()=>{throw Error('No sending in this fixture');}});`);
  write('src/services/wallet/vault.js', `export default {getBinding:()=>window.fixture.binding};`);
  write('src/services/wallet/selection.js', `export default {sameScope:(a,b)=>JSON.stringify(a)===JSON.stringify(b)};`);
  write('src/services/wallet/signMessage.js', `export const signMessage=()=>{throw Error('No signing in this fixture');};`);
  write('src/services/wallet/approvalOperation.js', `export const runApprovalOperation=()=>{throw Error('No signing in this fixture');};`);
  write('src/services/utils/notify.js', `export const notify={error:()=>{},success:()=>{}};`);
  write('src/services/utils/messaging.js', `export const sendInternal=(method,args)=>window.fixture.internal(method,args);`);
  write('src/services/wallet/blockApproval.js', `export const prepareBlockApproval=params=>window.fixture.prepare(params);export const isCurrentBlockApproval=value=>Boolean(value);`);
  write('src/services/utils/approvalContractCalls.js', `export const decodeApprovalCall=json=>({kind:'knownCall',contract:'Synthetic contract',to:json.toAddress,label:'Review synthetic details',method:'SyntheticMethod',args:[{name:'detail',label:'Synthetic detail',display:'Long inert detail '.repeat(70)}]});`);
  write('entry.jsx', `
import React from 'react';import {createRoot} from 'react-dom/client';import {Provider} from 'react-redux';import {HashRouter} from 'react-router-dom';
import Screen from './src/layouts/siteIntegrationLayout/siteIntegrationLayout';
const address='synthetic-account-'+ 'a'.repeat(44), binding={id:'inert-binding',ownerId:'inert-owner',scope:{walletName:'Synthetic wallet',walletId:address,address,index:0}};
let state={wallet:{address,isUnlocked:true},connectionParameters:{chainIdentifier:69,nodeUrl:'wss://node.fixture.invalid:35998'}},queue=[],sequence=0,preparation;
const listeners=new Set(),storageListeners=new Set(),counts={claims:0,rejections:0};
const store={getState:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},dispatch:()=>{}};
const request=(type='signMessage',label='Initial',ttl=60000)=>({version:4,id:'inert-'+(++sequence),type,params:type==='signMessage'?{message:'Inert message '+label+'\\n'+'Long review text '.repeat(100)}:{to:address,toAddress:address,tokenStandard:'zts1znnxxxxxxxxxxxxx9z4ulx',amount:'1'.repeat(78),chainIdentifier:69,data:''},origin:'https://'+label.toLowerCase()+'.fixture.invalid:8443',title:label,tabId:1,frameId:0,documentId:'inert-document',responseId:'inert-response-'+sequence,activation:crypto.randomUUID(),requestToken:crypto.randomUUID(),navigationTab:'inert-tab',navigationFrame:'inert-frame',binding,createdAt:Date.now(),expiresAt:Date.now()+ttl});
const replace=(type,label,ttl)=>{const next=request(type,label,ttl);queue=[next];for(const fn of storageListeners)fn({'znn.pendingRequests':{newValue:{[next.id]:next}}},'session');return next.id;};
window.fixture={binding,counts,replace,request,queueOnly:next=>{queue=[next];},bump:()=>{state={...state,wallet:{...state.wallet,revision:Math.random()}};listeners.forEach(fn=>fn());},
 temporarilyEmpty:()=>{const saved=queue;queue=[];for(const fn of storageListeners)fn({'znn.pendingRequests':{newValue:{}}},'session');setTimeout(()=>{queue=saved;},100);},
 internal:async method=>{if(method==='approvals.next')return queue[0]||null;if(method==='approvals.claim'){counts.claims++;return null;}if(method==='approvals.reject'){counts.rejections++;return true;}throw Error('Unexpected inert boundary');},
 prepare:params=>preparation||Promise.resolve({block:params,nodeUrl:state.connectionParameters.nodeUrl}),holdPreparation:()=>{preparation=new Promise(()=>{});},releasePreparation:()=>{preparation=null;},
 longRequest:type=>{const next=request(type,'Long'+type);next.origin='https://'+['a'.repeat(60),'b'.repeat(60),'c'.repeat(60),'fixture','invalid'].join('.')+':8443';queue=[next];for(const fn of storageListeners)fn({'znn.pendingRequests':{newValue:{[next.id]:next}}},'session');return next.origin;}};
Object.defineProperty(chrome,'storage',{value:{onChanged:{addListener:fn=>storageListeners.add(fn),removeListener:fn=>storageListeners.delete(fn)}}});
Object.defineProperty(chrome,'windows',{value:{getCurrent:async()=>({id:1})}});
queue=[request()];createRoot(document.querySelector('#app-container')).render(<Provider store={store}><HashRouter><div className="popup"><div className="main-layout"><Screen /></div></div></HashRouter></Provider>);
`);
  stage = 'compile';
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'production', context: extension, entry: path.join(extension, 'entry.jsx'),
      output: { path: extension, filename: 'fixture.js' }, devtool: false, performance: false,
      resolve: { modules: [path.join(root, 'node_modules')], alias: { 'znn-ts-sdk': path.join(extension, 'sdk.js') } },
      module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'),
        options: { presets: [require.resolve('@babel/preset-react')], configFile: false, babelrc: false } } }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(Error('Compilation failed')) : resolve()));
  });
  stage = 'browser startup';
  browser = spawn(process.env.CHROMIUM_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--enable-unsafe-extension-debugging',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError; browser.on('error', () => { launchError = true; }); browser.stderr.resume();
  let port;
  for (let i = 0; i < 200; i++) {
    if (launchError) throw Error('Browser unavailable');
    const file = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(file)) { port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); break; }
    await pause(50);
  }
  assert(port);
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0, runtimeErrors = 0; const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), call = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors++;
    if (call) { pending.delete(message.id); message.error ? call.reject(Error('Browser protocol failure')) : call.resolve(message.result); }
  };
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const loaded = await cdp('Extensions.loadUnpacked', { path: extension });
  const target = await cdp('Target.createTarget', { url: 'chrome-extension://' + loaded.id + '/page.html' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  const viewport = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await viewport(360, 400);
  const evaluate = async expression => {
    const output = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (output.exceptionDetails) throw Error('Fixture operation failed'); return output.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await pause(20); }
    throw Error('Expected state did not appear');
  };
  const key = async value => {
    const code = { Tab: 9, Enter: 13, End: 35 }[value];
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode: code,
      ...(value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, sessionId);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode: code }, sessionId);
  };
  const onReview = () => evaluate("document.activeElement.matches('.approval-screen')");
  const focusConfirm = () => evaluate("document.querySelector('.action-row button:last-child').focus()");
  const replace = async (type, label, ttl) => {
    await evaluate(`fixture.replace(${JSON.stringify(type)},${JSON.stringify(label)},${JSON.stringify(ttl)})`);
    await until(`document.querySelector('.site-title')?.textContent===${JSON.stringify(label)}`);
  };
  stage = 'request focus';
  await until("document.querySelector('.action-row button:last-child')?.textContent==='Sign'");
  if (process.argv.includes('--expect-baseline')) {
    await focusConfirm(); await replace('signMessage', 'Replacement');
    assert.equal(await evaluate("document.activeElement===document.querySelector('.action-row button:last-child')"), true);
    await viewport(280, 400);
    assert.equal(await evaluate('document.body.getBoundingClientRect().width>innerWidth'), true);
    result = { baseline: true, node: process.version, browser: version.Browser, replacementKeepsAuthorizationFocus: true, narrowWindowClipped: true };
    return;
  }
  assert.equal(await onReview(), true); await key('Enter');
  assert.equal(await evaluate('fixture.counts.claims'), 0);
  await focusConfirm(); await replace('signMessage', 'Replacement');
  assert.equal(await onReview(), true); await key('Enter');
  assert.equal(await evaluate('fixture.counts.claims'), 0);
  await cdp('DOM.enable', {}, sessionId);
  const { root: documentRoot } = await cdp('DOM.getDocument', {}, sessionId);
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '[role=region]' }, sessionId);
  const { nodes } = await cdp('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }, sessionId);
  assert(nodes.some(node => node.role?.value === 'region' && node.name?.value.includes('https://replacement.fixture.invalid:8443') && node.name.value.includes('Sign this message?')));
  await focusConfirm();
  const readingPosition = await evaluate("document.querySelector('.approval-screen').scrollTop");
  await evaluate('fixture.bump()'); await pause(50);
  assert.equal(await evaluate("document.activeElement===document.querySelector('.action-row button:last-child')"), true);
  assert.equal(await evaluate("document.querySelector('.approval-screen').scrollTop"), readingPosition);
  stage = 'request reappearance';
  await evaluate('fixture.temporarilyEmpty()');
  await until("!document.querySelector('.action-row')");
  await until("Boolean(document.querySelector('.action-row'))");
  assert.equal(await onReview(), true);
  stage = 'expiry replacement';
  await replace('signMessage', 'Expiring', 800); await focusConfirm();
  await evaluate("fixture.queueOnly(fixture.request('signMessage','AfterExpiry'))");
  await until("document.querySelector('.site-title')?.textContent==='AfterExpiry'");
  assert.equal(await onReview(), true); await key('Enter'); assert.equal(await evaluate('fixture.counts.claims'), 0);
  stage = 'disabled approval';
  await evaluate('fixture.holdPreparation()'); await replace('signAndSendBlock', 'Preparing');
  assert.equal(await onReview(), true);
  assert.equal(await evaluate("document.querySelector('.action-row button:last-child').disabled"), true);
  await key('Enter'); assert.equal(await evaluate('fixture.counts.claims'), 0);
  await evaluate('fixture.releasePreparation()');
  for (const type of ['connect', 'sendTransaction', 'signMessage', 'signAndSendBlock']) {
    stage = 'layout ' + type;
    await viewport(360, 400);
    const origin = await evaluate(`fixture.longRequest(${JSON.stringify(type)})`);
    await until(`document.querySelector('.site-title')?.textContent===${JSON.stringify('Long' + type)}`);
    if (type === 'signAndSendBlock') await until("Boolean(document.querySelector('.contract-arguments'))");
    assert.equal(await onReview(), true);
    for (const [width, height] of [[360, 400], [280, 400], [180, 300]]) {
      stage = 'layout ' + type + ' at ' + width + 'x' + height;
      await viewport(width, height);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await evaluate('document.body.getBoundingClientRect().width<=innerWidth'), true);
      assert.equal(await evaluate("document.querySelector('.approval-origin').textContent"), origin);
      const geometry = await evaluate(`(()=>{const screen=document.querySelector('.approval-screen'),actions=document.querySelector('.action-row'),origin=document.querySelector('.approval-origin');const r=actions.getBoundingClientRect(),o=origin.getBoundingClientRect();return {actionsVisible:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,originFits:o.left>=0&&o.right<=innerWidth+1,detailsFit:[...document.querySelectorAll('.confirm-details dd,.contract-arguments dd')].every(e=>e.getBoundingClientRect().right<=innerWidth+1),screenWidth:screen.scrollWidth<=screen.clientWidth+1};})()`);
      if (Object.values(geometry).some(value => !value)) console.error(JSON.stringify({ viewport: [width, height], ...geometry }));
      assert.deepEqual(geometry, { actionsVisible: true, originFits: true, detailsFit: true, screenWidth: true });
      stage = 'keyboard scroll ' + type + ' at ' + width + 'x' + height;
      await evaluate("document.querySelector('.approval-screen').focus()"); await key('End');
      try { await until("(()=>{const e=document.querySelector('.approval-screen');return e.scrollTop>0&&Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2;})()"); }
      catch (error) {
        console.error(JSON.stringify(await evaluate("(()=>{const e=document.querySelector('.approval-screen');return {scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,reviewFocused:document.activeElement===e};})()")));
        throw error;
      }
      stage = 'final detail visibility ' + type + ' at ' + width + 'x' + height;
      assert.equal(await evaluate("(()=>{const details=[...document.querySelectorAll('.confirm-details dd,.contract-arguments dd')];return details.at(-1).getBoundingClientRect().bottom<=document.querySelector('.action-row').getBoundingClientRect().top+1;})()"), true);
      await evaluate("document.querySelector('.approval-screen').scrollTop=0");
      await pause(250);
    }
  }
  stage = 'popup dimensions and callbacks';
  await evaluate("document.body.classList.remove('standalone-window')");
  assert.deepEqual(await evaluate('({width:document.body.offsetWidth,height:document.body.offsetHeight})'), { width: 360, height: 600 });
  await evaluate("document.body.classList.add('standalone-window')"); await viewport(360, 400);
  await replace('signMessage', 'Keyboard');
  await evaluate("document.querySelector('.action-row button:first-child').focus()"); await key('Enter');
  await until('fixture.counts.rejections===1'); assert.equal(await evaluate('fixture.counts.claims'), 0);
  assert.equal(runtimeErrors, 0);
  result = { baseline: false, node: process.version, browser: version.Browser, actualApprovalScreenAndPresentation: true,
    storageReplacementFocusReset: true, naturalExpiryFocusReset: true, sameRequestFocusPreserved: true, reappearingRequestFocusReset: true,
    noApprovalOnReviewEnter: true, labelledReviewInAccessibilityTree: true, disabledApprovalSafe: true,
    fourRequestTypesAtNarrowViewports: true, fullOriginAndLongDetailsFit: true, actionsVisible: true, keyboardScrollReachesFinalDetails: true,
    standardPopupDimensionsPreserved: true, nativeRejectionCallbackOnce: true, runtimeErrors };
})().catch(() => { console.error('Approval focus checks failed during ' + stage + '.'); process.exitCode = 1; }).finally(async () => {
  try { await cleanup(); } catch { console.error('Approval focus fixture cleanup failed.'); process.exitCode = 1; result = null; }
  clearTimeout(watchdog); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  if (result && !process.exitCode) console.log(JSON.stringify({ ...result, disposableProfileRemoved: !fs.existsSync(dir) }));
});
