import {
  getCondition,
  getReveal,
  type Batch,
  type ConditionDetail,
  type Reveal,
} from '../api';
import {
  decodePayload,
  esc,
  fmtCountdown,
  fmtUnix,
  statusChip,
  truncMiddle,
} from '../util';

const POLL_MS = 2000;

export function renderCondition(root: HTMLElement, id: string): () => void {
  root.innerHTML = `
    <p><a class="link" href="#/">back to committee</a></p>
    <section class="section">
      <h1>condition <span class="mono" title="${esc(id)}">${esc(truncMiddle(id, 14, 6))}</span></h1>
      <div id="meta" class="card"><p class="muted">loading condition…</p></div>
      <div id="countdown"></div>
    </section>
    <div id="reveal"></div>
  `;

  const metaEl = root.querySelector<HTMLElement>('#meta')!;
  const countdownEl = root.querySelector<HTMLElement>('#countdown')!;
  const revealEl = root.querySelector<HTMLElement>('#reveal')!;

  let condition: ConditionDetail | null = null;
  let revealed = false;
  let pollTimer: number | undefined;
  let countdownTimer: number | undefined;

  const renderCountdown = () => {
    if (!condition || condition.status !== 'pending' || condition.fires_at == null) {
      countdownEl.innerHTML = '';
      return;
    }
    const secs = condition.fires_at - Math.floor(Date.now() / 1000);
    countdownEl.innerHTML = `<p class="countdown">fires in <span class="num countdown-value">${esc(
      fmtCountdown(secs),
    )}</span></p>`;
  };

  const poll = async () => {
    try {
      condition = await getCondition(id);
    } catch (e) {
      metaEl.innerHTML = `<p class="error">could not load condition. ${esc(String(e))}</p>`;
      return;
    }
    metaEl.innerHTML = metaCard(condition);
    renderCountdown();

    if (condition.status === 'revealed' && !revealed) {
      const reveal = await getReveal(id).catch(() => null);
      if (reveal) {
        revealed = true;
        revealEl.innerHTML = revealSection(reveal, condition);
        if (pollTimer !== undefined) clearInterval(pollTimer);
        if (countdownTimer !== undefined) clearInterval(countdownTimer);
      }
    } else if (condition.status === 'stalled') {
      revealEl.innerHTML = `<section class="section"><p class="error">stalled. fewer than t verified shares arrived before the reveal timeout.</p></section>`;
    } else if (!revealed) {
      revealEl.innerHTML = `<section class="section"><p class="muted">not revealed yet. the sealed board stays dark until the condition fires and t shares arrive.</p></section>`;
    }
  };

  void poll();
  pollTimer = window.setInterval(() => void poll(), POLL_MS);
  countdownTimer = window.setInterval(renderCountdown, 1000);

  return () => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (countdownTimer !== undefined) clearInterval(countdownTimer);
  };
}

function metaCard(c: ConditionDetail): string {
  const fires =
    c.fires_at != null
      ? esc(fmtUnix(c.fires_at))
      : c.height != null
        ? `block ${c.height} on chain ${c.chain_id}`
        : '<span class="muted">unknown</span>';
  return `
    <dl class="stats">
      <div><dt>status</dt><dd>${statusChip(c.status)}</dd></div>
      <div><dt>kind</dt><dd>${esc(c.kind)}</dd></div>
      <div><dt>fires at</dt><dd>${fires}</dd></div>
      <div><dt>sealed</dt><dd class="num">${c.real_count}<span class="muted"> real / ${c.ciphertext_count} total</span></dd></div>
      <div><dt>created</dt><dd>${esc(fmtUnix(c.created_at))}</dd></div>
      <div><dt>committee</dt><dd><span class="mono" title="${esc(c.committee_id)}">${esc(
        truncMiddle(c.committee_id, 10, 6),
      )}</span></dd></div>
    </dl>
  `;
}

function revealSection(r: Reveal, c: ConditionDetail): string {
  return `
    <section class="section">
      <h2>revealed</h2>
      <p class="muted">revealed at ${esc(fmtUnix(r.revealed_at))}. merkle root
        <span class="mono" title="${esc(r.merkle_root)}">${esc(truncMiddle(r.merkle_root, 12, 10))}</span></p>
      ${boardTable(r)}
    </section>
    <section class="section">
      <h2>operator shares</h2>
      ${shareTable(r)}
    </section>
    <section class="section">
      <h2>batch timings</h2>
      ${timingTable(r.batches.length ? r.batches : c.batches)}
    </section>
  `;
}

function boardTable(r: Reveal): string {
  const rows = r.slots
    .map((s) => {
      const tags: string[] = [];
      if (s.is_dummy) tags.push('<span class="tag tag-dummy">dummy</span>');
      if (!s.valid) tags.push('<span class="tag tag-corrupt">corrupt</span>');
      const decoded = decodePayload(s.payload_b64);
      const payload = s.valid
        ? `<span class="${decoded.isHex ? 'mono' : ''}">${esc(decoded.text)}</span>`
        : '<span class="muted">unrecoverable</span>';
      return `<tr class="${s.is_dummy ? 'dummy-row' : ''}">
        <td class="num">${s.position}</td>
        <td><span class="mono" title="${esc(s.ct_hash)}">${esc(truncMiddle(s.ct_hash, 12, 10))}</span></td>
        <td>${payload} ${tags.join(' ')}</td>
      </tr>`;
    })
    .join('');
  return `<table>
    <thead><tr><th>slot</th><th>before, sealed (ct hash)</th><th>after, revealed</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function shareTable(r: Reveal): string {
  if (r.shares.length === 0) return '<p class="muted">no shares recorded.</p>';
  const first = Math.min(...r.shares.map((s) => s.submitted_at_ms));
  const rows = r.shares
    .map(
      (s) => `<tr class="${s.verified ? '' : 'share-rejected'}">
        <td class="num">operator ${s.operator_id}</td>
        <td class="num">+${s.submitted_at_ms - first} ms</td>
        <td>${s.verified ? 'yes' : '<strong>no, rejected</strong>'}</td>
      </tr>`,
    )
    .join('');
  return `<table>
    <thead><tr><th>operator</th><th>submitted (relative)</th><th>verified</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function timingTable(batches: Batch[]): string {
  if (batches.length === 0) return '<p class="muted">no batch timings recorded.</p>';
  const rows = batches
    .map(
      (b) => `<tr>
        <td class="num">${b.batch_index}</td>
        <td class="num">${b.predecrypt_ms ?? '<span class="muted">pending</span>'}${b.predecrypt_ms != null ? ' ms' : ''}</td>
        <td class="num">${b.finalize_ms ?? '<span class="muted">pending</span>'}${b.finalize_ms != null ? ' ms' : ''}</td>
      </tr>`,
    )
    .join('');
  return `<table>
    <thead><tr><th>batch</th><th>pre-decrypt (pipelined)</th><th>finalize</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
