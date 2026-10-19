'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the fixture's actual guard with a controlled protocol transport.
// No browser, profile, application data or network is created here.
const source = fs.readFileSync(path.join(__dirname, 'fixtures/production-browser.js'), 'utf8');
const start = source.indexOf('  const guardTarget = async (');
const end = source.indexOf('\n  const openTarget = async ', start);
assert(start > 0 && end > start, 'Guard source boundary is present');
const guardSource = source.slice(start, end);
const cases = [];

const run = async (type, rejectedMethod) => {
  const commands = [];
  const sessions = new Map();
  const targets = new Map();
  const stats = { guardedTargets: 0, guardedWorkers: 0, guardFailure: null };
  const sandbox = {
    sessions, targets, stats, setupScript: '', stopping: false, stopped: false, fatalError: null,
    failure: code => Object.assign(new Error('Controlled protocol rejection.'), { code }),
    cdp: async (method, params, sessionId) => {
      commands.push({ method, params, sessionId });
      if (method === rejectedMethod || (type === 'worker' && method === 'Network.emulateNetworkConditions')) {
        throw Object.assign(new Error('Controlled protocol rejection.'), { code: 'BROWSER_PROTOCOL_FAILED' });
      }
      return {};
    },
  };
  vm.runInNewContext(guardSource + '\nglobalThis.guard = guardTarget;', sandbox);
  await sandbox.guard({ sessionId: 'owned-session', targetInfo: { targetId: 'owned-target', type, url: '' } });
  let rejected = false;
  try { await targets.get('owned-target').ready; } catch { rejected = true; }
  await Promise.resolve();
  return { commands, stats, rejected, fatalError: sandbox.fatalError };
};

(async () => {
  const worker = await run('worker');
  assert.equal(worker.rejected, false);
  assert.equal(worker.fatalError, null);
  assert.equal(worker.stats.guardedWorkers, 1);
  assert.deepEqual(worker.commands.map(command => command.method), ['Network.enable', 'Network.setBlockedURLs',
    'Runtime.enable', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
  assert.deepEqual(Array.from(worker.commands[1].params.urls), ['http://*', 'https://*', 'ws://*', 'wss://*']);
  assert(worker.commands.every(command => command.sessionId === 'owned-session'));
  assert.equal(worker.commands[3].params.waitForDebuggerOnStart, true);
  cases.push('dedicated worker receives mandatory guards before resume');

  for (const method of ['Network.enable', 'Network.setBlockedURLs', 'Runtime.enable', 'Target.setAutoAttach']) {
    const failed = await run('worker', method);
    assert(failed.rejected);
    assert.equal(failed.fatalError?.code, 'BROWSER_NETWORK_GUARD_FAILED');
    assert.equal(failed.stats.guardFailure.phase, method);
    assert(!failed.commands.some(command => command.method === 'Runtime.runIfWaitingForDebugger'));
    assert.equal(failed.stats.guardedWorkers, 0);
    cases.push('worker stays paused when ' + method + ' fails');
  }

  for (const type of ['page', 'service_worker', 'shared_worker', 'other']) {
    const guarded = await run(type);
    const names = guarded.commands.map(command => command.method);
    assert.equal(guarded.rejected, false);
    assert(names.indexOf('Network.emulateNetworkConditions') > names.indexOf('Network.setBlockedURLs'));
    assert(names.indexOf('Network.emulateNetworkConditions') < names.indexOf('Runtime.runIfWaitingForDebugger'));
    assert.equal(guarded.commands.find(command => command.method === 'Network.emulateNetworkConditions').params.offline, true);
    const failed = await run(type, 'Network.emulateNetworkConditions');
    assert(failed.rejected);
    assert.equal(failed.fatalError?.code, 'BROWSER_NETWORK_GUARD_FAILED');
    assert(!failed.commands.some(command => command.method === 'Runtime.runIfWaitingForDebugger'));
    cases.push(type + ' retains required offline override and fail-closed rejection');
  }
  console.log(JSON.stringify({ guard_regression: true, cases: cases.length, passed: true }));
})().catch(() => { console.log(JSON.stringify({ guard_regression: true, passed: false })); process.exitCode = 1; });
