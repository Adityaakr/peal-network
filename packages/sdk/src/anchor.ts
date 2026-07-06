// Onchain anchoring against BteAnchor.sol (phase 7). Dependency-free:
// calldata is hand-encoded (fixed bytes32 args), reads go through raw
// eth_call, hashing through WebCrypto.
import type { BteClient } from './index.js';

/** Minimal signer shape: viem wallet clients and ethers signers both fit. */
export interface AnchorSigner {
  sendTransaction(tx: { to: `0x${string}`; data: `0x${string}` }): Promise<unknown>;
}

export interface AnchorConfig {
  signer: AnchorSigner;
  /** BteAnchor contract address. */
  contract: `0x${string}`;
}

// cast sig "commit(bytes32,bytes32)" / "revealRoot(bytes32,bytes32)" / "revealRoots(bytes32)"
export const SELECTORS = {
  commit: '0xe3ce094d',
  revealRoot: '0x4b1a5d84',
  revealRoots: '0x035cf5b5',
} as const;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Condition ids are strings offchain; onchain they are sha256(utf8(id)). */
export async function conditionIdToBytes32(conditionId: string): Promise<`0x${string}`> {
  return `0x${await sha256Hex(new TextEncoder().encode(conditionId))}`;
}

function encodeCall(selector: string, words: string[]): `0x${string}` {
  const body = words
    .map((w) => {
      const hex = w.replace(/^0x/, '');
      if (hex.length !== 64) throw new Error(`expected bytes32, got 0x${hex}`);
      return hex;
    })
    .join('');
  return `${selector}${body}` as `0x${string}`;
}

/** Send the BteAnchor.commit(conditionId, ctHash) transaction. */
export async function anchorCommit(
  anchor: AnchorConfig,
  conditionId: string,
  ctHash: string,
): Promise<void> {
  const data = encodeCall(SELECTORS.commit, [
    await conditionIdToBytes32(conditionId),
    `0x${ctHash.replace(/^0x/, '')}`,
  ]);
  await anchor.signer.sendTransaction({ to: anchor.contract, data });
}

/** Send BteAnchor.revealRoot (restricted to the coordinator address). */
export async function anchorRevealRoot(
  anchor: AnchorConfig,
  conditionId: string,
  merkleRoot: string,
): Promise<void> {
  const data = encodeCall(SELECTORS.revealRoot, [
    await conditionIdToBytes32(conditionId),
    `0x${merkleRoot.replace(/^0x/, '')}`,
  ]);
  await anchor.signer.sendTransaction({ to: anchor.contract, data });
}

/** Merkle over (position, payload): leaf = sha256(position_le_u32 || payload),
 * parent = sha256(left || right), odd node promoted. Mirrors the
 * coordinator's merkle.rs. */
export async function computeRevealRoot(
  slots: Array<{ position: number; payload: Uint8Array }>,
): Promise<string> {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  let level: Uint8Array[] = [];
  for (const slot of ordered) {
    const buf = new Uint8Array(4 + slot.payload.length);
    new DataView(buf.buffer).setUint32(0, slot.position, true);
    buf.set(slot.payload, 4);
    level.push(new Uint8Array(await crypto.subtle.digest('SHA-256', buf as BufferSource)));
  }
  if (level.length === 0) {
    return sha256Hex(new Uint8Array(0));
  }
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const pair = new Uint8Array(64);
        pair.set(level[i], 0);
        pair.set(level[i + 1], 32);
        next.push(new Uint8Array(await crypto.subtle.digest('SHA-256', pair as BufferSource)));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return [...level[0]].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyAnchorResult {
  matches: boolean;
  onchainRoot: string;
  recomputedRoot: string;
  coordinatorRoot: string;
}

/**
 * Trust-minimized reveal check: recompute the merkle root from the revealed
 * payloads and compare it against the root the coordinator published onchain.
 */
export async function verifyAnchor(
  conditionId: string,
  client: BteClient,
  opts: { rpcUrl: string; contract: `0x${string}` },
): Promise<VerifyAnchorResult> {
  const reveal = await client.reveal(conditionId);
  if (!reveal) throw new Error(`condition ${conditionId} is not revealed yet`);

  const recomputedRoot = await computeRevealRoot(reveal.slots);

  const data = encodeCall(SELECTORS.revealRoots, [await conditionIdToBytes32(conditionId)]);
  const resp = await fetch(opts.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: opts.contract, data }, 'latest'],
    }),
  });
  const json = (await resp.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(`eth_call failed: ${json.error.message}`);
  const onchainRoot = (json.result ?? '0x').replace(/^0x/, '').padStart(64, '0');

  return {
    matches:
      onchainRoot === recomputedRoot && recomputedRoot === reveal.merkleRoot,
    onchainRoot,
    recomputedRoot,
    coordinatorRoot: reveal.merkleRoot,
  };
}
