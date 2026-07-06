// Seal-only wasm module, inlined as base64 with lazy async init.
// No bundler config needed in vite, next, or node.
import initWasm, { Params, ct_hash } from './generated/seal/bte_wasm.js';
import WASM_B64 from './generated/seal/wasm-b64.js';

export function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

let ready: Promise<unknown> | null = null;

/** Idempotent lazy init of the inlined wasm module. */
export async function ensureWasm(): Promise<{ Params: typeof Params; ctHash: typeof ct_hash }> {
  if (!ready) {
    ready = initWasm({ module_or_path: b64ToBytes(WASM_B64) });
  }
  await ready;
  return { Params, ctHash: ct_hash };
}
