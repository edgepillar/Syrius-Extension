'use strict';

// Inert native baseline/candidate controls. No wallet or production application.
// Log only method/type/code enums, booleans and counts; never protocol payloads.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const filename = path.join(__dirname, 'fixtures/production-browser.js');
const candidate = fs.readFileSync(filename, 'utf8');
const baseline = execFileSync('git', ['show', 'f0a36fe0a6d3c871ff922010963f3e20f7dffc20:utils/fixtures/production-browser.js'], { encoding: 'utf8' });
assert.equal(crypto.createHash('sha256').update(baseline).digest('hex'), '027bc84b44156fb5c26ee2182bbb7514fe51344edd2db66cc61b33e5cad5d6ce');
const workerSource = `self.onmessage = async event => {
  const httpBlocked = await fetch(event.data.http, {signal:AbortSignal.timeout(2000)}).then(() => false, () => true);
  const webSocketBlocked = await new Promise(resolve => {
    let done = false; const socket = new WebSocket(event.data.ws);
    const finish = value => { if(done)return;done=true;clearTimeout(timer);socket.close();resolve(value); };
    const timer = setTimeout(() => finish(false), 2000);
    socket.onopen = () => finish(false); socket.onerror = () => finish(true);
  });
  self.postMessage({httpBlocked,webSocketBlocked,offline:navigator.onLine===false});
};`;
const reports = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const control of ['baseline', 'candidate', 'mandatory-block-list-failure']) {
    const report = { diagnostic_only: true, guard_regression: control, worker_attachments: 0,
      worker_resume_commands: 0, protocol_errors: [], listener_http_requests: 0, listener_ws_upgrades: 0 };
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syrius-owned-worker-network-'));
    fs.chmodSync(temporary, 0o700);
    const extensionDir = path.join(temporary, 'extension');
    fs.mkdirSync(extensionDir);
    fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({manifest_version:3,name:'Owned worker network control',version:'1.0',permissions:['storage']}));
    fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<!doctype html><title>Owned worker network control</title>');
    fs.writeFileSync(path.join(extensionDir, 'worker.js'), workerSource);
    const listener = http.createServer((_request, response) => { report.listener_http_requests++; response.end('owned'); });
    const connections = new Set();
    listener.on('connection', connection => { connections.add(connection); connection.on('close', () => connections.delete(connection)); });
    listener.on('upgrade', (request, socket) => {
      report.listener_ws_upgrades++;
      const accept = crypto.createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    });
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    let source = control === 'baseline' ? baseline : candidate;
    report.helper_sha256 = crypto.createHash('sha256').update(source).digest('hex');
    const replace = (before, after) => { assert.equal(source.split(before).length,2,'Unique diagnostic seam'); source=source.replace(before,after); };
    replace('    pending.set(next, {','    pending.set(next, { method, sessionId,');
    replace('    const guarded = (method, ...args) => { phase = method; return cdp(method, ...args); };',
      '    const guarded = (method, ...args) => { phase = method; if (target.type === "worker") { module.probe.sent(method); if (module.probe.inject && method === "Network.setBlockedURLs") args[0] = {urls:[null]}; } return cdp(method, ...args); };');
    replace('      const callback = pending.get(message.id);','      const callback = pending.get(message.id);\n      module.probe.message(message, callback);');
    const loaded = new Module(filename,module);
    loaded.filename=filename; loaded.paths=Module._nodeModulePaths(path.dirname(filename));
    const workerSessions = new Set();
    loaded.probe = { inject: control === 'mandatory-block-list-failure',
      sent(method) { if(method==='Runtime.runIfWaitingForDebugger')report.worker_resume_commands++; },
      message(message, callback) {
        if(message.method==='Target.attachedToTarget'&&message.params.targetInfo.type==='worker') { workerSessions.add(message.params.sessionId); report.worker_attachments++; }
        if(callback&&message.error&&workerSessions.has(callback.sessionId))report.protocol_errors.push({phase:callback.method,
          protocol_code:Number.isInteger(message.error.code)?message.error.code:null,
          error_class:message.error.message==='Not supported'?'NOT_SUPPORTED':message.error.code===-32602?'INVALID_PARAMETERS':'OTHER'});
      } };
    loaded._compile(source,filename);
    let browser, stopped = true;
    try {
      browser=await loaded.exports.startBrowser({extensionDir,profileDir:path.join(temporary,'profile')});
      report.browser=browser.browserVersion;
      const page=await browser.openPage();
      const endpoint={http:'http://127.0.0.1:'+listener.address().port+'/owned',ws:'ws://127.0.0.1:'+listener.address().port+'/owned'};
      const count=control==='candidate'?8:1;
      await browser.evaluate(page, `(()=>{globalThis.ownedResults=[];globalThis.ownedWorkers=Array.from({length:${count}},()=>{const worker=new Worker('worker.js');worker.onmessage=event=>ownedResults.push(event.data);worker.postMessage(${JSON.stringify(endpoint)});return worker});return true})()`);
      if(control==='candidate') {
        await browser.until(page,'ownedResults.length===8','owned worker responses',20000);
        report.worker_results=await browser.evaluate(page,'ownedResults');
        assert(report.worker_results.every(result=>result.httpBlocked&&result.webSocketBlocked&&result.offline));
        assert.equal(browser.stats.guardedWorkers,8);
        assert.equal(report.worker_resume_commands,8);
        assert.equal(browser.stats.guardFailure,null);
        report.expected_result=true;
      } else {
        const by=Date.now()+10000;
        while(!browser.stats.guardFailure&&Date.now()<by)await sleep(10);
        assert(browser.stats.guardFailure,'Guard fails closed');
        assert.equal(browser.stats.guardFailure.phase,control==='baseline'?'Network.emulateNetworkConditions':'Network.setBlockedURLs');
        assert.equal(report.worker_resume_commands,0);
        assert(report.protocol_errors.some(error=>control==='baseline'?error.error_class==='NOT_SUPPORTED':error.error_class==='INVALID_PARAMETERS'));
        report.expected_result=true;
      }
    } catch(error) { report.expected_result=false; report.failure_code=error.code||'ASSERTION'; }
    finally {
      if(browser) {
        report.guard_failure=browser.stats.guardFailure;
        try{await browser.stop();}catch(error){stopped=false;report.cleanup_error=error.code||'UNKNOWN';}
        report.network={...browser.stats};
      }
      for(const connection of connections)connection.destroy();
      await new Promise(resolve=>listener.close(resolve));
      if(stopped)fs.rmSync(temporary,{recursive:true,force:true});
      report.fixture_removed=!fs.existsSync(temporary);
      assert.equal(report.listener_http_requests,0);assert.equal(report.listener_ws_upgrades,0);
      reports.push(report);console.log(JSON.stringify(report));
    }
  }
  const passed=reports.length===3&&reports.every(report=>report.expected_result&&report.fixture_removed&&report.network?.externalResponses===0&&report.network?.externalWebSocketHandshakes===0);
  console.log(JSON.stringify({diagnostic_summary:true,controls:reports.length,passed,production_keyfile_qualified:false}));
  if(!passed)process.exitCode=1;
})().catch(()=>{console.log(JSON.stringify({diagnostic_incomplete:true}));process.exitCode=1;});
