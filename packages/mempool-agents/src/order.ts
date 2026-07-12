// The swap order, and its on-chain payload encoding.
//
// The sealed payload is the abi-encoding of the order tuple, so the exact bytes
// the browser seals are the bytes PealMempool.executeBatch decodes and the bytes
// that go into the merkle leaf. One encoding, end to end: seal -> reveal ->
// settle all agree.
import { decodeAbiParameters, encodeAbiParameters, type Address } from 'viem';

export interface SwapOrder {
  trader: Address;
  baseToQuote: boolean;
  amountIn: bigint;
  minOut: bigint;
  to: Address;
}

const PARAMS = [
  { name: 'trader', type: 'address' },
  { name: 'baseToQuote', type: 'bool' },
  { name: 'amountIn', type: 'uint256' },
  { name: 'minOut', type: 'uint256' },
  { name: 'to', type: 'address' },
] as const;

export function encodeOrder(o: SwapOrder): `0x${string}` {
  return encodeAbiParameters(PARAMS, [o.trader, o.baseToQuote, o.amountIn, o.minOut, o.to]);
}

export function decodeOrder(payload: `0x${string}`): SwapOrder {
  const [trader, baseToQuote, amountIn, minOut, to] = decodeAbiParameters(PARAMS, payload);
  return { trader, baseToQuote, amountIn, minOut, to };
}
