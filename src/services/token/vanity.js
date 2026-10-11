import { Zenon, Primitives, utils as sdkUtils } from 'znn-ts-sdk';
import { ethers } from 'ethers';
import { sha3_256 } from 'js-sha3';

import vault from '../wallet/vault';
import { headOf } from './blockHead';
import { createSearch, expectedTries } from './ztsSearch';
import { fail } from '../utils/errors';

// Issuing a token whose id has a chosen prefix or suffix (./ztsSearch.js says
// why the nonce is free to choose).
//
// The block is filled in once, before the search: the id depends on its
// height, previous hash and acknowledged momentum, so those are fixed and the
// nonce is all that varies. The node accepts an old acknowledged momentum, so
// a long search is fine; another block from the same account landing first is
// not, and is checked again before signing.
//
// Three checks stand between a search and the 1 ZNN fee: the bytes searched
// over hash to what the SDK computes for the block, the signed block's hash
// gives the id that was found, and the account's frontier is still the one
// the block was built on.

const { BlockUtils } = sdkUtils;
const { idOf } = createSearch(sha3_256);

const zeroNonce = '0000000000000000';

// Fills in the block and checks it can be searched: paid for with fused
// plasma, and hashed here exactly as the SDK hashes it.
// The account is fixed here too: switching address during a search must not
// hand the block to another key.
const prepare = async (template, addressIndex = vault.getSelectedIndex()) => {
  const zenon = Zenon.getSingleton();
  const key = await vault.getSigningKeyPair(addressIndex);
  const block = await BlockUtils._checkAndSetFields(zenon, template, key);
  const plasma = await zenon.embedded.plasma.getRequiredPoWForAccountBlock(
    new Primitives.GetRequiredParam(block.address, block.blockType, block.toAddress, block.data)
  );
  if (plasma.requiredDifficulty !== 0) {
    throw fail(410);
  }
  block.fusedPlasma = plasma.basePlasma;
  block.difficulty = 0;
  block.nonce = zeroNonce;

  const head = headOf(block);
  const ours = sha3_256(ethers.utils.concat([head, new Uint8Array(8)]));
  const theirs = (await BlockUtils.getTransactionHash(block)).toString();
  if (ours !== theirs) throw fail(411);
  return { block, addressIndex, head: ethers.utils.hexlify(head).slice(2) };
};

// Runs the search on every core but one. Resolves with { nonce, zts }; a
// `signal` abort ends every worker.
const search = ({ head, prefix, suffix, onProgress, signal }) =>
  new Promise((resolve, reject) => {
    const count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
    const workers = [];
    let tried = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      for (const worker of workers) worker.terminate();
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(result);
    };
    const cancel = () => finish(fail(412));
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener('abort', cancel, { once: true });

    // A different high word per worker, so no two try the same nonce.
    const his = new Set();

    const start = (hi) => {
      const worker = new Worker(chrome.runtime.getURL('zts-search-worker.js'));
      workers.push(worker);
      worker.onerror = () => finish(fail(413));
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data?.ready) {
          try {
            worker.postMessage({ head, prefix, suffix, hi, chunk: 20000 });
          } catch (error) {
            finish(fail(413));
          }
        } else if (data?.found && /^[0-9a-f]{16}$/.test(data.nonce) && typeof data.zts === 'string') {
          finish(null, { nonce: data.nonce, zts: data.zts, tried: tried + data.tried });
        } else if (Number.isInteger(data?.tried)) {
          tried += data.tried;
          onProgress?.(tried, expectedTries(prefix, suffix));
        } else {
          if (data?.error) console.warn('[E413]', data.error);
          finish(fail(413));
        }
      };
    };
    try {
      while (his.size < count) his.add(crypto.getRandomValues(new Uint32Array(1))[0]);
      his.forEach(start);
    } catch (error) {
      finish(fail(413));
    }
  });

// Signs the searched block with the found nonce and sends it. Used as the
// background sender's `send`.
const publish = async (block, { nonce, zts }, addressIndex) => {
  const zenon = Zenon.getSingleton();
  const frontier = await zenon.ledger.getFrontierBlock(block.address);
  if ((frontier?.hash?.toString() || '') !== (block.height > 1 ? block.previousHash.toString() : '')) {
    throw fail(414);
  }
  block.nonce = nonce;
  const key = await vault.getSigningKeyPair(addressIndex);
  const signed = await BlockUtils._setHashAndSignature(block, key);
  if (idOf(signed.hash.getBytes()) !== zts) throw fail(415);
  await zenon.ledger.publishRawTransaction(signed);
  return signed;
};

export { prepare, search, publish, idOf };
