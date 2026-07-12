// The settler: the coordinator's on-chain arm.
//
// It watches the coordinator's reveal API for mempool-tagged conditions that
// have opened, reconstructs the batch's (position, payload) slots exactly as
// revealed, and submits PealMempool.executeBatch. The contract re-derives the
// merkle root and refuses anything that is not the revealed batch, so the
// settler cannot substitute an ordering even though it holds the key.
//
// This runs as a TS service rather than inside the Rust coordinator, so the
// shipped devnet is untouched; all chain interaction lives here.
import { sha256, toBytes, toHex } from 'viem';
import { pealMempoolAbi } from './abi.js';
import { chainFor, loadDeployment, publicClient, requireKey, walletFor } from './config.js';

const d = loadDeployment();
const pub = publicClient(d);
const wallet = walletFor(d, requireKey('DEPLOYER_PRIVATE_KEY')); // deployer == coordinator
const COORD = process.env.COORDINATOR_URL ?? 'http://localhost:8080';
const TAG = 'mempool';
const POLL_MS = 1500;

interface ConditionSummary {
  id: string;
  status: string;
  tag?: string | null;
}
interface RevealSlot {
  position: number;
  ct_hash: string;
  is_dummy: boolean;
  payload_b64: string;
}
interface Reveal {
  merkle_root: string;
  slots: RevealSlot[];
}

const settled = new Set<string>();

function b64ToHex(b64: string): `0x${string}` {
  return toHex(Uint8Array.from(Buffer.from(b64, 'base64')));
}

/** conditionId string -> bytes32, matching bte-sdk anchor.ts (sha256(utf8(id))). */
function cond32(id: string): `0x${string}` {
  return sha256(toBytes(id));
}

async function settle(id: string): Promise<void> {
  if (settled.has(id)) return;
  settled.add(id); // optimistic: don't double-submit while the tx is in flight

  const key = cond32(id);
  const already = (await pub.readContract({
    address: d.pealMempool, abi: pealMempoolAbi, functionName: 'settledRoot', args: [key],
  })) as `0x${string}`;
  if (already !== `0x${'0'.repeat(64)}`) {
    console.log(`[settler] ${id.slice(0, 10)} already settled on-chain`);
    return;
  }

  const reveal = (await (await fetch(`${COORD}/v0/reveals/${encodeURIComponent(id)}`)).json()) as Reveal;
  const slots = [...reveal.slots]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ position: s.position, isReal: !s.is_dummy, payload: b64ToHex(s.payload_b64) }));

  const root = (`0x${reveal.merkle_root.replace(/^0x/, '')}`) as `0x${string}`;
  const real = slots.filter((s) => s.isReal).length;
  console.log(`[settler] opening ${id.slice(0, 10)} on-chain: ${slots.length} slots, ${real} real`);

  const hash = await wallet.writeContract({
    address: d.pealMempool, abi: pealMempoolAbi, functionName: 'executeBatch',
    args: [key, slots, root], chain: chainFor(d),
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`[settler] SETTLED ${id.slice(0, 10)} in ${hash} (block ${rcpt.blockNumber})`);
}

async function poll(): Promise<void> {
  try {
    const body = (await (await fetch(`${COORD}/v0/conditions`)).json()) as { conditions: ConditionSummary[] };
    for (const c of body.conditions) {
      if (c.tag === TAG && c.status === 'revealed' && !settled.has(c.id)) {
        await settle(c.id).catch((e) => {
          settled.delete(c.id); // let a transient failure retry next tick
          console.error(`[settler] failed ${c.id.slice(0, 10)}:`, e instanceof Error ? e.message : e);
        });
      }
    }
  } catch (e) {
    console.error('[settler] poll error:', e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  console.log(`[settler] ${wallet.account.address} settling ${TAG} reveals from ${COORD} -> ${d.pealMempool}`);
  await poll();
  setInterval(() => void poll(), POLL_MS);
}

void main();
