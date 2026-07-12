// The encrypted mempool: one swap, sent into two mempools at once.
//
// WHAT IS SIMULATED: the pool, the searcher, the block. No chain is involved
// and nobody's money moves. The left side is a faithful constant-product model
// of a sandwich (see mempool/amm.ts), not a live attack.
//
// WHAT IS REAL: everything on the right that says Peal. The swap is sealed in
// this tab by the same wasm seal the SDK ships, against the live committee's
// params. It joins a real batch under a real condition. And the plaintext the
// swap finally executes on is read back out of the coordinator's reveal API,
// not out of a variable in this file. If the committee never opens the batch,
// the right-hand side never resolves. That is the point.
//
// The trust caveat (a dealer-trusted ceremony, operators that do not yet
// verify their own cue) is stated on the page rather than hidden. Here it
// costs nothing: there is no real money to front-run.
import { BteClient } from 'bte-sdk';
import { API_BASE, getCondition, getReveal, listConditions, type ConditionDetail } from '../api';
import { bestSandwich, fairEth, type Pool, type Sandwich } from '../mempool/amm';
import { decodePayload, esc, fmtCountdown, truncMiddle } from '../util';

const POLL_MS = 1500;
const ROUND_SECS = 30;
/** Never join a round about to freeze: the seal would race the cue. */
const MIN_JOIN_SECS = 12;
const TAG = 'mempool';
/** Consecutive failed polls before a run is declared dead. */
const MAX_MISSES = 4;

/** $6m of liquidity, ETH at $3,000. Deep enough that the sandwich is about
 * your slippage rather than about the pool being a toy. */
const POOL: Pool = { usdc: 3_000_000, eth: 1000 };

interface SwapOrder {
  k: 'swap';
  /** USDC in. */
  in: number;
  /** Slippage tolerance, as a fraction. */
  slip: number;
}

type Phase = 'idle' | 'sealing' | 'racing' | 'done' | 'error';

type StepState = 'todo' | 'active' | 'done';
interface Step {
  label: string;
  detail?: string;
  state: StepState;
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const eth = (n: number) => `${n.toFixed(4)} ETH`;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function renderMempool(root: HTMLElement): () => void {
  const previousTitle = document.title;
  document.title = 'Peal Network. the encrypted mempool';

  const client = new BteClient({ url: API_BASE });
  let phase: Phase = 'idle';
  let dead = false;
  let pollTimer: number | undefined;
  let tickTimer: number | undefined;

  /** The searcher's side is a pure function of the order, so it is computed
   * once up front and then narrated. */
  let order: SwapOrder | null = null;
  let sandwich: Sandwich | null = null;

  let publicSteps: Step[] = [];
  let pealSteps: Step[] = [];

  let ctHash = '';
  let conditionId = '';
  let condition: ConditionDetail | null = null;
  let batchSize = 0;
  /** ETH received on the Peal side, computed from the REVEALED plaintext. */
  let pealEth: number | null = null;
  let realCount = 0;
  let misses = 0;

  root.innerHTML = `
    <section class="mp">
      <header class="mp-head">
        <h1 class="hero-title">one swap. two mempools.</h1>
        <p class="hero-sub">a searcher is watching both. on the left it can read your trade
        before it lands, so it wraps a sandwich around you and takes the difference. on the
        right it sees ciphertext and has nothing to act on. same trade, same pool, same
        searcher.</p>
      </header>

      <form class="mp-form card" id="mp-form" autocomplete="off">
        <p class="scenario-kicker">Try Peal Playground</p>
        <p class="scenario-prompt">You are buying ETH with USDC on a ${usd(POOL.usdc * 2)} pool.
        ETH is at ${usd(POOL.usdc / POOL.eth)}.</p>
        <div class="pg-row">
          <label class="pg-control pg-control-grow">
            <span class="field-label">you swap (USDC)</span>
            <input type="number" id="mp-amount" value="50000"
                   min="100" max="500000" step="100" required />
          </label>
          <label class="pg-control pg-control-select">
            <span class="field-label">slippage tolerance</span>
            <select id="mp-slip">
              <option value="0.001">0.1%</option>
              <option value="0.005" selected>0.5%</option>
              <option value="0.01">1%</option>
              <option value="0.03">3%</option>
            </select>
          </label>
          <button type="submit" class="btn btn-primary" id="mp-go">send it to both</button>
        </div>
        <p class="field-hint" id="mp-quote"></p>
        <p class="error" id="mp-error" hidden></p>
      </form>

      <div class="mp-grid" id="mp-grid" hidden>
        <article class="mp-side mp-public">
          <header class="mp-side-head">
            <h2>public mempool</h2>
            <span class="chip chip-stalled">readable</span>
          </header>
          <div id="mp-public-body"></div>
        </article>
        <article class="mp-side mp-peal">
          <header class="mp-side-head">
            <h2>peal mempool</h2>
            <span class="chip chip-frozen">sealed</span>
          </header>
          <div id="mp-peal-body"></div>
        </article>
      </div>

      <p class="mp-verdict" id="mp-verdict" hidden></p>

      <div class="trust-note mp-trust">
        <p><strong>what is real here, and what is not.</strong></p>
        <p>The pool, the searcher and the block are a simulation. No chain is involved and
        nobody's money moves; the left-hand sandwich is a constant-product model of the attack,
        not a live one.</p>
        <p>The sealing is not simulated. Your swap is encrypted in this tab by the same wasm the
        SDK ships, against the live committee's real parameters, and it joins a real batch under
        a real cue. The plaintext the right-hand swap executes on is read back out of the
        coordinator's reveal, not kept in a variable in your browser. If the committee never
        opens the batch, the right-hand side never resolves.</p>
        <p>And the honest gap: on this devnet the committee comes from a trusted dealer, and the
        operators do not yet verify the cue for themselves. So today the cryptography is real but
        the decentralisation is not, and a dishonest operator could read your swap early. That is
        survivable here because there is no money on the table. It is exactly what has to be
        fixed before this could sit in front of a real chain.</p>
      </div>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>('#mp-form')!;
  const amountEl = root.querySelector<HTMLInputElement>('#mp-amount')!;
  const slipEl = root.querySelector<HTMLSelectElement>('#mp-slip')!;
  const goEl = root.querySelector<HTMLButtonElement>('#mp-go')!;
  const quoteEl = root.querySelector<HTMLElement>('#mp-quote')!;
  const errorEl = root.querySelector<HTMLElement>('#mp-error')!;
  const gridEl = root.querySelector<HTMLElement>('#mp-grid')!;
  const publicEl = root.querySelector<HTMLElement>('#mp-public-body')!;
  const pealEl = root.querySelector<HTMLElement>('#mp-peal-body')!;
  const verdictEl = root.querySelector<HTMLElement>('#mp-verdict')!;

  // ---- the quote, live as you type -------------------------------------
  function readOrder(): SwapOrder {
    return {
      k: 'swap',
      in: Math.max(100, Math.min(500_000, Number(amountEl.value) || 0)),
      slip: Number(slipEl.value),
    };
  }

  function paintQuote(): void {
    if (phase !== 'idle') return;
    const o = readOrder();
    const out = fairEth(POOL, o.in);
    quoteEl.innerHTML =
      `quoted at <span class="num">${esc(eth(out))}</span>, and you will accept as little as ` +
      `<span class="num">${esc(eth(out * (1 - o.slip)))}</span>. ` +
      `that floor is the whole game: a searcher will take everything above it that it can.`;
  }

  amountEl.addEventListener('input', paintQuote);
  slipEl.addEventListener('change', paintQuote);
  paintQuote();

  // ---- rendering --------------------------------------------------------
  function stepsHtml(steps: Step[]): string {
    const items = steps
      .map((s) => {
        const detail = s.detail ? `<span class="trace-detail">${s.detail}</span>` : '';
        return `<li class="trace-step trace-${s.state}">
          <span class="trace-marker" aria-hidden="true"></span>
          <span class="trace-body"><span class="trace-label">${esc(s.label)}</span>${detail}</span>
        </li>`;
      })
      .join('');
    return `<ol class="trace">${items}</ol>`;
  }

  function paintPublic(): void {
    if (!order || !sandwich) return;
    const s = sandwich;
    const done = publicSteps.every((x) => x.state === 'done');
    const result = !done
      ? ''
      : s.worthIt
        ? `<div class="mp-result mp-result-bad">
             <p class="mp-result-line">you received <span class="num">${esc(eth(s.victimEth))}</span>,
             not the <span class="num">${esc(eth(s.fairEth))}</span> you were quoted.</p>
             <p class="mp-result-take">the searcher took <span class="num">${esc(usd2(s.profit))}</span> off you.
             it cost you <span class="num">${esc(usd2(s.lostUsd))}</span>, which is
             <span class="num">${((s.lostEth / s.fairEth) * 100).toFixed(2)}%</span>, the exact slippage you allowed.</p>
           </div>`
        : `<div class="mp-result">
             <p class="mp-result-line">you received <span class="num">${esc(eth(s.victimEth))}</span>, in full.</p>
             <p class="mp-result-take">this swap was too small to sandwich profitably: the 0.3% pool fee on
             both of the searcher's legs ate the edge, so it passed. being readable did not cost you here.
             it costs you as soon as the trade is worth wrapping.</p>
           </div>`;
    publicEl.innerHTML = stepsHtml(publicSteps) + result;
  }

  function paintPeal(): void {
    if (!order) return;
    let result = '';
    if (pealEth != null) {
      const padding = batchSize - realCount;
      result = `<div class="mp-result mp-result-good">
        <p class="mp-result-line">you received <span class="num">${esc(eth(pealEth))}</span>,
        exactly what you were quoted.</p>
        <p class="mp-result-take">the searcher took <span class="num">${esc(usd2(0))}</span>.
        it never learned there was a swap to wrap.</p>
        <p class="mp-result-foot">that figure is not a constant in this page. it is what the
        revealed plaintext, fetched from the coordinator, buys against the untouched pool.
        the batch carried ${realCount} real ${realCount === 1 ? 'ciphertext' : 'ciphertexts'}
        and ${padding} of padding, so its size never leaked either.</p>
      </div>`;
    }
    pealEl.innerHTML = stepsHtml(pealSteps) + result;
  }

  function paintVerdict(): void {
    if (phase !== 'done' || !sandwich || pealEth == null) return;
    const s = sandwich;
    verdictEl.hidden = false;
    verdictEl.innerHTML = s.worthIt
      ? `in the readable mempool the sandwich took <span class="num accent">${esc(usd2(s.lostUsd))}</span> from
         this trade. in the sealed one it took <span class="num accent">nothing</span>, because sandwiching
         requires reading the trade first, and there was nothing to read.`
      : `this trade was too small to be worth sandwiching, so both mempools gave you the same fill.
         raise the amount and send it again: the readable side starts leaking the moment the trade is
         worth wrapping, and the sealed side does not.`;
  }

  function setError(msg: string): void {
    phase = 'error';
    errorEl.hidden = false;
    errorEl.textContent = msg;
    goEl.disabled = false;
    goEl.textContent = 'try again';
  }

  // ---- the public mempool: narrate the sandwich -------------------------
  async function runPublic(o: SwapOrder, s: Sandwich): Promise<void> {
    const cleartext = JSON.stringify({ swap: `${o.in} USDC -> ETH`, minOut: +s.minEthOut.toFixed(4) });
    publicSteps = [
      { label: 'your swap enters the mempool', state: 'active' },
      { label: 'a searcher reads it', state: 'todo' },
      { label: 'it buys in front of you', state: 'todo' },
      { label: 'your swap fills at the price it left behind', state: 'todo' },
      { label: 'it sells into your buy', state: 'todo' },
    ];
    paintPublic();
    await wait(700);
    if (dead) return;

    publicSteps[0].state = 'done';
    publicSteps[0].detail = `<span class="mono mp-clear">${esc(cleartext)}</span>`;
    publicSteps[1].state = 'active';
    paintPublic();
    await wait(900);
    if (dead) return;

    publicSteps[1].state = 'done';
    publicSteps[1].detail = s.worthIt
      ? 'amount, direction and your revert floor, all in the clear. that is everything it needs.'
      : 'amount, direction and your revert floor, all in the clear. it just is not worth acting on.';
    if (!s.worthIt) {
      publicSteps[2] = { label: 'the searcher passes', state: 'done', detail: 'the fee on both legs is larger than the edge.' };
      publicSteps[3] = { label: 'your swap fills, untouched', state: 'done' };
      publicSteps.length = 4;
      paintPublic();
      return;
    }
    publicSteps[2].state = 'active';
    paintPublic();
    await wait(900);
    if (dead) return;

    publicSteps[2].state = 'done';
    publicSteps[2].detail =
      `front-runs with <span class="num">${esc(usd(s.frontRunUsdc))}</span>, sized to push you to ` +
      `<span class="num">${esc(eth(s.minEthOut))}</span> and not one wei lower. any harder and you revert, and it earns nothing.`;
    publicSteps[3].state = 'active';
    paintPublic();
    await wait(900);
    if (dead) return;

    publicSteps[3].state = 'done';
    publicSteps[3].detail = `you get <span class="num">${esc(eth(s.victimEth))}</span>. it clears your floor, so it does not revert. you have no idea.`;
    publicSteps[4].state = 'active';
    paintPublic();
    await wait(900);
    if (dead) return;

    publicSteps[4].state = 'done';
    publicSteps[4].detail = `sells the <span class="num">${esc(eth(s.frontRunEth))}</span> back into the price you just paid, for <span class="num">${esc(usd2(s.profit))}</span> of profit.`;
    paintPublic();
  }

  // ---- the peal mempool: real seal, real cue, real reveal ---------------
  /** Join an open mempool round if one is live, else open one. Co-tenants are
   * the point: other people's swaps really do share your batch. */
  async function joinOrOpenRound(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    try {
      const open = (await listConditions())
        .filter(
          (c) =>
            c.tag === TAG &&
            c.status === 'pending' &&
            c.fires_at != null &&
            c.fires_at - now >= MIN_JOIN_SECS,
        )
        .sort((a, b) => (a.fires_at ?? 0) - (b.fires_at ?? 0));
      if (open.length > 0) return open[0].id;
    } catch {
      // Listing is a nicety; failing to find a round is not fatal.
    }
    return client.condition({ in: ROUND_SECS, tag: TAG });
  }

  async function runPeal(o: SwapOrder): Promise<void> {
    pealSteps = [
      { label: 'your swap is sealed in this tab', state: 'active' },
      { label: 'the searcher reads the mempool', state: 'todo' },
      { label: 'the builder fixes the order over ciphertext', state: 'todo' },
      { label: 'the cue fires and the whole batch opens at once', state: 'todo' },
      { label: 'your swap fills at the price you were quoted', state: 'todo' },
    ];
    paintPeal();

    const committee = await client.committee();
    batchSize = committee.b;
    conditionId = await joinOrOpenRound();
    const sealed = await client.seal(JSON.stringify(o), conditionId);
    ctHash = sealed.ctHash;
    if (dead) return;

    pealSteps[0].state = 'done';
    pealSteps[0].detail =
      `encrypted to ${committee.n} operators, any ${committee.t} of which open it on the cue. ` +
      `only the ciphertext left your browser.`;
    pealSteps[1].state = 'active';
    paintPeal();
    await wait(900);
    if (dead) return;

    pealSteps[1].state = 'done';
    pealSteps[1].detail =
      `<span class="mono mp-cipher">${esc(ctHash)}</span>` +
      `<span class="mp-nothing">that is your sealed blob, by its hash. no amount, no direction, no revert floor. ` +
      `nothing to wrap a sandwich around.</span>`;
    pealSteps[2].state = 'active';
    paintPeal();
    await wait(900);
    if (dead) return;

    pealSteps[2].state = 'done';
    pealSteps[2].detail = `${batchSize} slots, ordered without a single one of them being read. the order is committed before anybody knows what it contains.`;
    pealSteps[3].state = 'active';
    paintPeal();

    // From here the coordinator drives: poll the real condition, then the real
    // reveal. Nothing below is on a timer of ours.
    startPolling();
  }

  function startPolling(): void {
    const tick = () => {
      if (!condition?.fires_at || pealEth != null) return;
      const secs = condition.fires_at - Math.floor(Date.now() / 1000);
      pealSteps[3].detail =
        secs > 0
          ? `the batch freezes in <span class="num accent">${esc(fmtCountdown(secs))}</span>. until then it is just ciphertext sitting in a queue.`
          : 'the cue fired. the operators are posting their shares.';
      paintPeal();
    };

    const poll = async () => {
      if (dead || pealEth != null) return;
      try {
        condition = await getCondition(conditionId);
        realCount = condition.real_count;
        tick();
        if (condition.status !== 'revealed') return;

        const reveal = await getReveal(conditionId);
        if (!reveal) return;
        const slot = reveal.slots.find((s) => s.ct_hash === ctHash);
        if (!slot || !slot.valid) {
          setError('the batch opened but this tab could not find its own slot in it.');
          return;
        }
        // The plaintext comes back from the network, not from our own memory.
        // Executing on it is what makes the right-hand number real.
        const revealed = JSON.parse(decodePayload(slot.payload_b64).text) as SwapOrder;
        pealEth = fairEth(POOL, revealed.in);

        pealSteps[3].state = 'done';
        pealSteps[3].detail =
          `slot <span class="num">${slot.position}</span> of ${batchSize}, opened at the cue with every other slot. ` +
          `the network published the root <span class="mono">${esc(truncMiddle(reveal.merkle_root, 10, 8))}</span> over the batch.`;
        pealSteps[4].state = 'done';
        pealSteps[4].detail = `the searcher learned the amount at the same instant the pool did. by then the order was already fixed.`;
        phase = 'done';
        stopPolling();
        goEl.disabled = false;
        goEl.textContent = 'send another';
        paintPeal();
        paintVerdict();
        misses = 0;
      } catch (e) {
        // The cue is minutes away and the coordinator is finalizing a batch
        // under load, so a single 5xx here means nothing. Only a coordinator
        // that stays unreachable is worth failing the run over.
        if (++misses < MAX_MISSES) return;
        setError(`could not reach the coordinator (${String(e)}).`);
        stopPolling();
      }
    };

    void poll();
    pollTimer = window.setInterval(() => void poll(), POLL_MS);
    tickTimer = window.setInterval(tick, 1000);
  }

  function stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    pollTimer = undefined;
    tickTimer = undefined;
  }

  // ---- go ---------------------------------------------------------------
  const onSubmit = (e: Event) => {
    e.preventDefault();
    if (phase === 'sealing' || phase === 'racing') return;

    stopPolling();
    order = readOrder();
    sandwich = bestSandwich(POOL, order.in, order.slip);
    pealEth = null;
    condition = null;
    realCount = 0;
    misses = 0;
    errorEl.hidden = true;
    verdictEl.hidden = true;
    gridEl.hidden = false;
    goEl.disabled = true;
    goEl.textContent = 'in flight…';
    phase = 'racing';

    // Both mempools see the same order at the same moment. The left one is
    // narrated on a timer; the right one is driven by the coordinator.
    void runPublic(order, sandwich);
    void runPeal(order).catch((err) => setError(`could not seal (${String(err)}).`));
  };

  form.addEventListener('submit', onSubmit);

  return () => {
    dead = true;
    stopPolling();
    form.removeEventListener('submit', onSubmit);
    document.title = previousTitle;
  };
}
