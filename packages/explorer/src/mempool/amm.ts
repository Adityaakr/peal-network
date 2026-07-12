/** Constant-product AMM math for the encrypted-mempool demo.
 *
 * The pool, the searcher and the block are a SIMULATION: no chain is involved
 * and nobody's money moves. What is not simulated is the sealing on the Peal
 * side, which runs the real wasm seal against the real committee and reads the
 * plaintext back out of the real reveal (see pages/mempool.ts).
 *
 * The simulation exists to price the one thing a mempool leak actually costs
 * you: the sandwich.
 */

export interface Pool {
  usdc: number;
  eth: number;
}

/** 0.3%, the uniswap-v2 swap fee. It is what makes small swaps not worth
 * sandwiching, so it has to be here for the numbers to be honest. */
const FEE = 0.003;

/** Uniswap-v2 constant product: what `amountIn` of one side buys of the other. */
export function amountOut(amountIn: number, reserveIn: number, reserveOut: number): number {
  if (amountIn <= 0) return 0;
  const inWithFee = amountIn * (1 - FEE);
  return (reserveOut * inWithFee) / (reserveIn + inWithFee);
}

export function buyEth(pool: Pool, usdcIn: number): { ethOut: number; pool: Pool } {
  const ethOut = amountOut(usdcIn, pool.usdc, pool.eth);
  return { ethOut, pool: { usdc: pool.usdc + usdcIn, eth: pool.eth - ethOut } };
}

export function sellEth(pool: Pool, ethIn: number): { usdcOut: number; pool: Pool } {
  const usdcOut = amountOut(ethIn, pool.eth, pool.usdc);
  return { usdcOut, pool: { eth: pool.eth + ethIn, usdc: pool.usdc - usdcOut } };
}

/** Mid price, for valuing the ETH you did not receive. */
export function spot(pool: Pool): number {
  return pool.usdc / pool.eth;
}

/** What you receive with nobody in front of you. */
export function fairEth(pool: Pool, usdcIn: number): number {
  return buyEth(pool, usdcIn).ethOut;
}

export interface Sandwich {
  /** USDC the searcher front-runs with. */
  frontRunUsdc: number;
  /** ETH it accumulates ahead of you. */
  frontRunEth: number;
  /** USDC it walks away with, net of what it put in. */
  profit: number;
  /** ETH you receive, wrapped. */
  victimEth: number;
  /** ETH you would have received alone. */
  fairEth: number;
  /** The amountOutMin on your swap: below this it reverts. */
  minEthOut: number;
  /** ETH the sandwich cost you. */
  lostEth: number;
  /** ...valued at the pre-trade mid price. */
  lostUsd: number;
  /** False when the fee eats the edge and a rational searcher just passes. */
  worthIt: boolean;
}

function simulate(
  pool: Pool,
  victimUsdc: number,
  frontRunUsdc: number,
  slippage: number,
): Sandwich {
  const front = buyEth(pool, frontRunUsdc);
  const victim = buyEth(front.pool, victimUsdc);
  const back = sellEth(victim.pool, front.ethOut);
  const fair = fairEth(pool, victimUsdc);
  const lostEth = fair - victim.ethOut;
  const profit = back.usdcOut - frontRunUsdc;
  return {
    frontRunUsdc,
    frontRunEth: front.ethOut,
    profit,
    victimEth: victim.ethOut,
    fairEth: fair,
    minEthOut: fair * (1 - slippage),
    lostEth,
    lostUsd: lostEth * spot(pool),
    worthIt: profit > 0,
  };
}

/**
 * What a real searcher does to you.
 *
 * The size of a sandwich is not bounded by the searcher's appetite. It is
 * bounded by YOUR slippage tolerance: your swap carries an amountOutMin, and a
 * front-run big enough to push you under it makes your trade revert, which
 * leaves the searcher holding inventory and no victim. So it front-runs to
 * exactly the edge of what you said you would tolerate, and no further.
 *
 * That is the whole result, and it is why the loss on the public side lands so
 * close to your slippage setting: the tolerance is not protection, it is the
 * quote you gave the searcher. Profit rises monotonically in front-run size up
 * to that wall, so the searcher's real choice is found by bisecting for the
 * wall, not by maximising an interior peak.
 */
export function bestSandwich(pool: Pool, victimUsdc: number, slippage: number): Sandwich {
  const minOut = fairEth(pool, victimUsdc) * (1 - slippage);

  // victimEth is strictly decreasing in the front-run, so bisect for the
  // largest front-run that still clears amountOutMin.
  let lo = 0;
  let hi = pool.usdc;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (simulate(pool, victimUsdc, mid, slippage).victimEth >= minOut) lo = mid;
    else hi = mid;
  }

  const best = simulate(pool, victimUsdc, lo, slippage);
  // A searcher that cannot clear the 0.3% fee on both legs simply passes, and
  // your swap goes through untouched. Small swaps are not worth sandwiching.
  return best.worthIt ? best : simulate(pool, victimUsdc, 0, slippage);
}
