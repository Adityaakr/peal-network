import { getCommittee, listConditions, type ConditionSummary } from '../api';
import { esc, fmtUnix, statusChip, truncMiddle } from '../util';

const POLL_MS = 2000;

export function renderHome(root: HTMLElement): () => void {
  root.innerHTML = `
    <section class="section">
      <h1>committee</h1>
      <div id="committee" class="card"><p class="muted">loading committee…</p></div>
    </section>
    <section class="section">
      <h2>operators</h2>
      <div id="roster" class="roster"></div>
    </section>
    <section class="section">
      <h2>conditions</h2>
      <div id="conditions"><p class="muted">loading conditions…</p></div>
    </section>
  `;

  const committeeEl = root.querySelector<HTMLElement>('#committee')!;
  const rosterEl = root.querySelector<HTMLElement>('#roster')!;
  const conditionsEl = root.querySelector<HTMLElement>('#conditions')!;

  void loadCommittee(committeeEl, rosterEl);

  let lastRendered = '';
  const poll = async () => {
    try {
      const conditions = await listConditions();
      const html = conditionsTable(conditions);
      if (html !== lastRendered) {
        conditionsEl.innerHTML = html;
        lastRendered = html;
      }
    } catch (e) {
      if (!lastRendered) {
        conditionsEl.innerHTML = `<p class="error">could not load conditions. ${esc(String(e))}</p>`;
      }
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  return () => clearInterval(timer);
}

async function loadCommittee(committeeEl: HTMLElement, rosterEl: HTMLElement): Promise<void> {
  try {
    const c = await getCommittee();
    committeeEl.innerHTML = `
      <dl class="stats">
        <div><dt>operators</dt><dd class="num">${c.n}</dd></div>
        <div><dt>threshold</dt><dd class="num">${c.t} of ${c.n}</dd></div>
        <div><dt>batch size</dt><dd class="num">${c.b}</dd></div>
        <div><dt>params digest</dt><dd><span class="mono" title="${esc(c.params_digest)}">${esc(truncMiddle(c.params_digest, 12, 10))}</span></dd></div>
        <div><dt>created</dt><dd>${esc(fmtUnix(c.created_at))}</dd></div>
      </dl>
    `;
    const entries: string[] = [];
    for (let i = 1; i <= c.n; i++) {
      entries.push(`<span class="operator">operator ${i}</span>`);
    }
    rosterEl.innerHTML = entries.join('');
  } catch (e) {
    committeeEl.innerHTML = `<p class="error">could not load committee. ${esc(String(e))}</p>`;
  }
}

function conditionsTable(conditions: ConditionSummary[]): string {
  if (conditions.length === 0) {
    return '<p class="muted">no conditions yet.</p>';
  }
  const rows = conditions
    .map((c) => {
      const fires = c.fires_at != null ? esc(fmtUnix(c.fires_at)) : '<span class="muted">at block</span>';
      return `<tr>
        <td><a class="mono link" href="#/condition/${encodeURIComponent(c.id)}">${esc(truncMiddle(c.id, 14, 6))}</a></td>
        <td>${esc(c.kind)}</td>
        <td>${statusChip(c.status)}</td>
        <td>${fires}</td>
        <td class="num">${c.real_count}<span class="muted"> / ${c.ciphertext_count}</span></td>
        <td>${esc(fmtUnix(c.created_at))}</td>
      </tr>`;
    })
    .join('');
  return `<table>
    <thead><tr>
      <th>condition</th><th>kind</th><th>status</th><th>fires at</th>
      <th>sealed (real / total)</th><th>created</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
