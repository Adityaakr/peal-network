// The protocol reference, written as a self-contained article: the problem,
// the lifecycle, the cryptography (punctured setup, shares, pipelined
// recovery, the commitment), private seals, architecture, integration,
// production posture and the trust model. Every claim traces to spec/index.md
// or the coordinator/SDK code. docs/protocol.html carries the same spine.
const sections = [
  ['overview', 'overview'],
  ['problem', 'the problem'],
  ['lifecycle', 'lifecycle'],
  ['cryptography', 'cryptography'],
  ['privacy', 'private seals'],
  ['architecture', 'architecture'],
  ['integration', 'building on it'],
  ['production', 'production'],
  ['trust', 'trust model'],
] as const;

export function renderProtocol(root: HTMLElement): () => void {
  const previousTitle = document.title;
  document.title = 'Peal protocol. how guaranteed reveal works';
  root.innerHTML = `
    <article class="protocol-article">
      <header id="overview">
        <p class="kicker">Peal protocol reference, v0</p>
        <h1>your users commit. the network reveals.</h1>
        <p class="lede">Peal is a programmable encryption network for information that must stay
        unreadable until a shared condition fires. A browser seals a payload once. A threshold
        committee later opens the whole batch, publicly and verifiably. Nobody returns for a
        second reveal transaction. This page explains how that works at the protocol level, how
        to build on it, and what separates today's devnet from production.</p>
        <div class="facts" aria-label="protocol defaults">
          <div><span>committee</span><strong>n = 5</strong></div>
          <div><span>threshold</span><strong>t = 3</strong></div>
          <div><span>fixed batch</span><strong>B = 64</strong></div>
          <div><span>crypto overhead</span><strong>64 bytes</strong></div>
          <div><span>share size</span><strong>48 bytes</strong></div>
        </div>
      </header>

      <nav class="protocol-nav" aria-label="protocol sections">
        ${sections.map(([id, label], index) => `<button type="button" data-section="${id}"${index === 0 ? ' aria-current="true"' : ''}>${label}</button>`).join('')}
      </nav>

      <section>
        <h2 id="problem">the problem</h2>
        <p>Commit-reveal is the standard way to hide information on a public ledger until a
        deadline: users post a hash now and the preimage later. Its failure mode is the second
        step. The bidder who lost never opens their commitment. The voter who changed their mind
        never reveals. Every application built on the pattern inherits reveal deadlines, griefing
        margins, and incomplete data, because revealing is voluntary.</p>
        <p>Peal removes the second step. The payload is encrypted, not hashed, and decryption is
        a network duty rather than a user choice. Before the cue, fewer than
        <span class="mono">t</span> committee operators can recover nothing. After the cue, any
        <span class="mono">t</span> valid shares recover every slot in the frozen batch. The
        user's only action is the seal.</p>
      </section>

      <section>
        <h2 id="lifecycle">what one payload goes through</h2>
        <ol class="steps">
          <li><div>
            <h3>fetch committee parameters</h3>
            <p>The SDK downloads the public parameters, checks their SHA-256 digest, and caches
            them. The parameter set fixes n, t and B for the committee's lifetime.</p>
            <span class="api">GET /v0/committees/:id</span>
          </div></li>
          <li><div>
            <h3>seal in the browser</h3>
            <p>Wasm runs the Fujisaki-Okamoto transform locally. Only the sealed wire bytes ever
            leave the device; for a short text payload that is about 110 bytes total.</p>
            <span class="api">seal(payload, conditionId)</span>
          </div></li>
          <li><div>
            <h3>content-address the ciphertext</h3>
            <p>The coordinator parses the wire format, enforces the payload cap, computes
            ct_hash = sha256(wire), and stores the blob under its condition. Submission order
            does not choose the slot.</p>
            <span class="api">POST /v0/ciphertexts</span>
          </div></li>
          <li><div>
            <h3>the cue fires, the batch freezes</h3>
            <p>A wall-clock or block-height condition fires. The coordinator pads to 64 slots,
            sorts every ciphertext by hash, assigns positions, and makes the batch immutable.
            Positions are a pure function of the ciphertext set, so any party can reproduce
            them.</p>
            <span class="api">pending &rarr; frozen</span>
          </div></li>
          <li><div>
            <h3>operators post one share each</h3>
            <p>Each outbound-only node polls for frozen work and computes one 48-byte partial for
            the entire batch. The share is the same size whether the batch holds one real seal or
            sixty-four.</p>
            <span class="api">POST /v0/shares</span>
          </div></li>
          <li><div>
            <h3>verify, combine, recover</h3>
            <p>Every share must pass a public pairing check before it counts. Any t valid shares
            are Lagrange-combined once for the whole batch, and a per-slot integrity check
            isolates any mauled ciphertext to its own slot.</p>
            <span class="api">frozen &rarr; revealed</span>
          </div></li>
          <li><div>
            <h3>publish an auditable record</h3>
            <p>The reveal carries every slot, its validity bit, the full operator share log with
            timings, and a merkle root over position and payload. Anyone can recompute the
            root.</p>
            <span class="api">GET /v0/reveals/:id</span>
          </div></li>
        </ol>
      </section>

      <section>
        <h2 id="cryptography">the cryptography</h2>
        <p>Peal wraps Commonware's batched threshold encryption
        (<a class="link" href="https://eprint.iacr.org/2026/760" target="_blank" rel="noopener">eprint 2026/760</a>,
        implemented in
        <a class="link" href="https://github.com/commonwarexyz/simple-bte" target="_blank" rel="noopener">simple-bte</a>)
        without modifying the scheme. The wrapper adds conditions, persistence, operator
        transport, share verification, and public records.</p>

        <h3>the wire format</h3>
        <p>A sealed ciphertext is a fixed header and a masked body. The cryptographic overhead is
        64 bytes: a 48-byte KEM header and a 16-byte key mask.</p>
        <div class="eq">
          <div><span>magic + type</span><code>"BTE0" || 0x01, 5 bytes</code></div>
          <div><span>KEM header</span><code>ct&#8320; = [k]&#8321;, 48 bytes compressed G1</code></div>
          <div><span>masked key</span><code>ct&#8321; = H&#8342;([k &middot; &tau;<sup>B+1</sup>]&#8348;) xor K, 16 bytes</code></div>
          <div><span>masked body</span><code>ct&#8322; = H&#8344;(K) xor payload</code></div>
          <div><span>integrity</span><code>k = H&#7523;(K, payload), verify [k]&#8321; = ct&#8320;</code></div>
        </div>
        <p>The last line is the Fujisaki-Okamoto trick: the ephemeral scalar is re-derived from
        the recovered plaintext, so a ciphertext that was tampered with fails to reproduce its
        own header and is flagged corrupt in its slot without poisoning the rest of the batch.</p>

        <h3>the punctured setup</h3>
        <p>The ceremony publishes powers of a secret <span class="mono">&tau;</span> with one
        deliberate hole. Everyone can encrypt toward the missing power. Nobody holds it. That
        hole is the entire trick.</p>
        <div class="eq">
          <div><span>published</span><code>[&tau;<sup>j</sup>]&#8322; for j = 0 &hellip; 2B, except j = B+1 (zeroed)</code></div>
          <div><span>encryption key</span><code>ek = [&tau;<sup>B+1</sup>]&#8348;, target group only</code></div>
          <div><span>dealt to operators</span><code>Shamir shares of &tau;&sup1; &hellip; &tau;<sup>B</sup>, threshold t of n</code></div>
          <div><span>per-operator public</span><code>verification values v&#7522;&#690;</code></div>
        </div>
        <p>Sealing masks the payload key with
        <span class="mono">[k &middot; &tau;<sup>B+1</sup>]&#8348;</span>, a value no single party
        can compute: the power exists only in the target group and its preimage was destroyed at
        setup (in v0, that destruction is the dealer's promise; see the trust model). Recovering
        it for a batch requires cross-terms from the published powers combined with t operator
        shares of the lower powers. This is also why every batch is exactly B slots: the setup
        material and the FFT domain are sized to B at the ceremony, so short batches are padded
        with self-sealed dummies rather than shrinking the math.</p>

        <h3>shares and public verification</h3>
        <div class="cols">
          <div>
            <p class="mono" style="font-size:15px">pd&#11388; = &Sigma;&#7522; &sigma;&#11388;&#7522; &middot; ct&#7522;,&#8320;</p>
            <p class="muted" style="font-size:14.5px">Operator j runs one multi-scalar
            multiplication over the frozen headers. The result is a single compressed G1 point,
            48 bytes, covering the whole batch.</p>
          </div>
          <div>
            <p class="mono" style="font-size:15px">e(pd&#11388;, g&#8322;) = &Pi;&#7522; e(ct&#7522;,&#8320;, v&#11388;&#7522;)</p>
            <p class="muted" style="font-size:14.5px">The coordinator checks each partial against
            public verification keys. A forged share is attributable, recorded as rejected, and
            never counts toward the threshold.</p>
          </div>
        </div>

        <h3>pipelined recovery</h3>
        <p>The expensive part of decryption does not wait for operators. The FFT cross-terms
        (<span class="mono">O(B log B)</span> group operations plus <span class="mono">O(B)</span>
        pairings) depend only on the frozen ciphertexts and the public parameters, so they
        compute at freeze time while shares are still in flight; an integration test asserts
        pre-decrypt finishes before the first share exists. When t verified shares land, finalize
        is one Lagrange interpolation at x = 0 plus the per-slot FO re-check. On the public
        devnet, pre-decrypt runs in roughly 250 ms and finalize in 40 to 150 ms for a full
        64-slot batch.</p>

        <h3>the commitment</h3>
        <div class="eq">
          <div><span>leaf</span><code>sha256(position_le_u32 || payload)</code></div>
          <div><span>parent</span><code>sha256(left || right), odd node promoted</code></div>
          <div><span>padding payload</span><code>"BTE_DUMMY_V0:" || 16 random bytes</code></div>
        </div>
        <p>The merkle root binds every slot, padding included, so a published reveal cannot be
        edited without detection. Padding slots are real self-sealed ciphertexts with a tagged
        random payload. Anyone can download the batch from the reveal endpoint, recompute the
        root, and compare it with the published or onchain-anchored value.</p>
      </section>

      <section>
        <h2 id="privacy">two privacy layers</h2>
        <p><strong>The network proves when. The link decides who.</strong> Threshold reveal is
        deliberately public: after the cue, every slot's plaintext is on the record so anyone can
        verify the batch. That is exactly right for auctions and votes, and wrong for a personal
        note, so a second, purely client-side layer exists on top.</p>
        <div class="eq">
          <div><span>private payload</span><code>"BTEP1" || iv (12 bytes) || AES-128-GCM(key, text)</code></div>
          <div><span>share link</span><code>#/s/&lt;condition&gt;/&lt;ct_hash&gt;/&lt;key&gt;</code></div>
        </div>
        <p>Before sealing, the browser wraps a personal payload in AES-128-GCM. The key never
        reaches any server: it rides only in the share link's hash fragment, which browsers do
        not transmit. The network still proves when the seal opened; only people holding the
        full link learn what it said. The explorer marks such slots private instead of printing
        ciphertext. The trade is explicit: there is no recovery path. Lose every copy of the
        link and the content stays unreadable, by construction.</p>
      </section>

      <section>
        <h2 id="architecture">architecture</h2>
        <p>The design separates the public edge from secret-bearing operators. The browser and
        explorer are public. The coordinator is a scheduler and aggregator that never sees
        pre-cue plaintext. Operator nodes accept no inbound connections and never expose their
        keystores.</p>

        <figure>
          <svg viewBox="0 0 720 380" width="100%" role="img" aria-label="Peal architecture: dapp with SDK sends ciphertext through a TLS edge to the coordinator, which persists state, exchanges work and shares with five outbound-only operator nodes, and optionally anchors the reveal root onchain" font-family="Satoshi, system-ui, sans-serif">
            <defs>
              <marker id="parr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0.5 L7.5 4 L0 7.5" fill="none" stroke="#6b7280" stroke-width="1.3"/>
              </marker>
            </defs>
            <rect x="12" y="30" width="150" height="72" rx="10" fill="#eff6ff" stroke="#2563eb"/>
            <text x="87" y="58" text-anchor="middle" font-size="14" font-weight="700" fill="#111827">dapp + SDK</text>
            <text x="87" y="78" text-anchor="middle" font-size="11.5" fill="#6b7280">seals in wasm</text>
            <rect x="222" y="30" width="150" height="72" rx="10" fill="#fff" stroke="#e5e7eb"/>
            <text x="297" y="58" text-anchor="middle" font-size="14" font-weight="700" fill="#111827">TLS edge</text>
            <text x="297" y="78" text-anchor="middle" font-size="11.5" fill="#6b7280">explorer, rate limit</text>
            <rect x="432" y="30" width="170" height="72" rx="10" fill="#fff" stroke="#2563eb" stroke-width="1.5"/>
            <text x="517" y="58" text-anchor="middle" font-size="14" font-weight="700" fill="#111827">coordinator</text>
            <text x="517" y="78" text-anchor="middle" font-size="11.5" fill="#6b7280">freeze, verify, recover</text>
            <rect x="432" y="146" width="170" height="56" rx="10" fill="#f8fafc" stroke="#e5e7eb"/>
            <text x="517" y="170" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">database</text>
            <text x="517" y="188" text-anchor="middle" font-size="11.5" fill="#6b7280">ciphertexts + reveals</text>
            <rect x="222" y="146" width="150" height="56" rx="10" fill="#fff" stroke="#e5e7eb" stroke-dasharray="4 3"/>
            <text x="297" y="170" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">onchain anchor</text>
            <text x="297" y="188" text-anchor="middle" font-size="11.5" fill="#6b7280">optional, reveal root</text>
            <g>
              <rect x="80" y="272" width="104" height="66" rx="10" fill="#fff" stroke="#e5e7eb"/>
              <rect x="204" y="272" width="104" height="66" rx="10" fill="#fff" stroke="#e5e7eb"/>
              <rect x="328" y="272" width="104" height="66" rx="10" fill="#fff" stroke="#e5e7eb"/>
              <rect x="452" y="272" width="104" height="66" rx="10" fill="#fff" stroke="#e5e7eb"/>
              <rect x="576" y="272" width="104" height="66" rx="10" fill="#fff" stroke="#e5e7eb"/>
              <text x="132" y="300" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">node 1</text>
              <text x="256" y="300" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">node 2</text>
              <text x="380" y="300" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">node 3</text>
              <text x="504" y="300" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">node 4</text>
              <text x="628" y="300" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">node 5</text>
              <text x="132" y="318" text-anchor="middle" font-size="10.5" fill="#6b7280">keystore</text>
              <text x="256" y="318" text-anchor="middle" font-size="10.5" fill="#6b7280">keystore</text>
              <text x="380" y="318" text-anchor="middle" font-size="10.5" fill="#6b7280">keystore</text>
              <text x="504" y="318" text-anchor="middle" font-size="10.5" fill="#6b7280">keystore</text>
              <text x="628" y="318" text-anchor="middle" font-size="10.5" fill="#6b7280">keystore</text>
            </g>
            <line x1="162" y1="66" x2="216" y2="66" stroke="#6b7280" stroke-width="1.3" marker-end="url(#parr)"/>
            <text x="189" y="56" text-anchor="middle" font-size="10.5" fill="#6b7280">ciphertext</text>
            <line x1="372" y1="66" x2="426" y2="66" stroke="#6b7280" stroke-width="1.3" marker-end="url(#parr)"/>
            <text x="399" y="56" text-anchor="middle" font-size="10.5" fill="#6b7280">/v0</text>
            <line x1="517" y1="102" x2="517" y2="140" stroke="#6b7280" stroke-width="1.3" marker-end="url(#parr)"/>
            <line x1="426" y1="174" x2="378" y2="174" stroke="#6b7280" stroke-width="1.3" marker-end="url(#parr)"/>
            <text x="402" y="164" text-anchor="middle" font-size="10.5" fill="#6b7280">root</text>
            <line x1="640" y1="266" x2="608" y2="108" stroke="#2563eb" stroke-width="1.3" marker-end="url(#parr)"/>
            <text x="648" y="182" text-anchor="start" font-size="10.5" fill="#2563eb">poll work,</text>
            <text x="648" y="196" text-anchor="start" font-size="10.5" fill="#2563eb">post shares</text>
          </svg>
          <figcaption>Operator nodes connect outbound only; the coordinator can never reach into
          a keystore. Any 3 of the 5 shares complete a reveal.</figcaption>
        </figure>

        <div class="table-wrap">
          <table>
            <thead><tr><th>component</th><th>role</th></tr></thead>
            <tbody>
              <tr><td class="mono">bte-sdk</td><td>fetches and digest-checks parameters, seals in wasm, submits ciphertexts, waits for reveals, optionally verifies the anchored root</td></tr>
              <tr><td class="mono">bte-coordinator</td><td>condition engine, SQLite state machine, deterministic freeze, pipelined pre-decrypt, pairing checks, REST /v0</td></tr>
              <tr><td class="mono">bte-node</td><td>polls outbound for frozen work, decrypts its local argon2id + ChaCha20 keystore, computes one partial, posts it</td></tr>
              <tr><td class="mono">BteAnchor.sol</td><td>commits ciphertext hashes to conditions and records the final merkle root from an authorized publisher</td></tr>
            </tbody>
          </table>
        </div>

        <p>A condition moves through four states: <span class="mono">pending</span> (accepting
        seals), <span class="mono">frozen</span> (collecting shares),
        <span class="mono">revealed</span> (immutable result), and
        <span class="mono">stalled</span> if fewer than t shares arrive before the timeout.
        Stalled is honest, not terminal: one late valid share resumes recovery. A condition is
        never falsely revealed.</p>
      </section>

      <section>
        <h2 id="integration">building on it</h2>
        <p>The product path is four calls: create a condition, seal locally, store the returned
        hash, wait for the reveal.</p>
        <pre><code>import { BteClient } from 'bte-sdk';

const peal = new BteClient({ url: 'https://peal.network' });

const conditionId = await peal.condition({ in: 60, tag: 'auction-v1' });
const sealed = await peal.seal(JSON.stringify({
  app: 'auction-v1',
  conditionId,
  lotId: 'lot-42',
  bid: 815,
  nonce: crypto.randomUUID()
}), conditionId);

const reveal = await peal.waitForReveal(conditionId);
const slot = reveal.slots.find((s) =&gt; s.ctHash === sealed.ctHash);

if (!slot?.valid) throw new Error('sealed bid did not recover');
console.log(slot.text);</code></pre>

        <ul>
          <li><strong>Pin the committee digest.</strong> Ship the expected public-parameter
          digest with your app; do not silently accept a coordinator-selected committee.</li>
          <li><strong>Bind the payload.</strong> Put the condition id, app domain, action type,
          and a nonce inside the encrypted bytes and validate them after reveal, so a copied
          ciphertext cannot be replayed into a different context undetected.</li>
          <li><strong>Persist the ciphertext hash.</strong> It is the stable handle for the
          commitment. Store it in your database or anchor it onchain before the cue.</li>
          <li><strong>Tag your conditions.</strong> The optional tag (up to 32 characters of
          <span class="mono">a-z 0-9 : _ -</span>) lets your app find its own rounds and never
          join a stranger's. This playground keeps bid rounds, vote rounds, and capsules apart
          this way.</li>
          <li><strong>Treat reveal as asynchronous.</strong> Poll or index; handle pending,
          frozen, stalled, revealed, and per-slot corrupt states explicitly.</li>
          <li><strong>Layer client-side encryption for personal data.</strong> The network
          reveal is public; if only the recipient should read the content, encrypt inside the
          payload and carry the key in your own channel, as private capsules do in the link
          fragment.</li>
        </ul>

        <h3>failure behavior is explicit</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>failure</th><th>behavior</th></tr></thead>
            <tbody>
              <tr><td>one node offline</td><td>reveal continues with any 3 of 5</td></tr>
              <tr><td>one forged share</td><td>pairing check rejects it; the operator identity stays visible in the log</td></tr>
              <tr><td>one mauled ciphertext</td><td>that slot is marked corrupt; the other 63 recover</td></tr>
              <tr><td>coordinator restart</td><td>state reloads from the database, pre-decrypt recomputes, nodes repoll</td></tr>
              <tr><td>fewer than t shares</td><td>the condition stalls; it is never falsely revealed</td></tr>
              <tr><td>late valid share</td><td>a stalled condition completes automatically</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 id="production">production posture</h2>
        <p>The current stack runs a transparent public devnet: a real threshold committee, public
        share verification, durable state, recovery after restart, TLS, rate limiting, and honest
        stall states. The decisive blocker for real value is the ceremony: v0 uses a single
        trusted dealer who generates <span class="mono">&tau;</span>, deals the shares, and
        promises to destroy it.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>layer</th><th>v0 today</th><th>production target</th></tr></thead>
            <tbody>
              <tr><td>key generation</td><td>offline trusted dealer</td><td>audited DKG; no machine ever knows the whole trapdoor</td></tr>
              <tr><td>operator lifecycle</td><td>new ceremony to replace one</td><td>proactive resharing and rotation under a stable public key</td></tr>
              <tr><td>availability</td><td>coordinator database</td><td>replicated store plus blob or calldata copies of ciphertexts</td></tr>
              <tr><td>accountability</td><td>invalid shares attributable</td><td>stake, slashing, signed work receipts</td></tr>
              <tr><td>verification</td><td>offchain pairing check, anchored root</td><td>EIP-2537 onchain verification of shares and combination</td></tr>
              <tr><td>operations</td><td>health endpoint, structured logs</td><td>SLOs, metrics, paging, tracing, backups</td></tr>
              <tr><td>security</td><td>unaudited prototype</td><td>independent audits and ceremony review</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 id="trust">the trust model, stated precisely</h2>
        <div class="cols">
          <div>
            <h3>you do not trust</h3>
            <ul>
              <li>the coordinator with pre-cue plaintext</li>
              <li>any coalition smaller than the threshold</li>
              <li>an operator's claim that its share is valid</li>
              <li>the explorer's arithmetic; recompute the root yourself</li>
            </ul>
          </div>
          <div>
            <h3>v0 still requires trust</h3>
            <ul>
              <li>the dealer did not retain or leak &tau;</li>
              <li>at least t operators answer after the cue</li>
              <li>the coordinator includes every submitted ciphertext</li>
              <li>the deployment preserves ciphertext availability</li>
            </ul>
          </div>
        </div>
        <p class="warning"><strong>v0 is dealer-trusted and unaudited.</strong> Use it for
        testnets, demos, and integration work. Do not protect real value with it. DKG and an
        independent audit are prerequisites for that claim.</p>
        <div class="article-links">
          <a class="link" href="https://eprint.iacr.org/2026/760" target="_blank" rel="noopener">the paper</a>
          <a class="link" href="https://github.com/commonwarexyz/simple-bte" target="_blank" rel="noopener">simple-bte</a>
          <a class="link" href="https://github.com/Adityaakr/batched-threshold-encryption" target="_blank" rel="noopener">Peal source</a>
          <a class="link" href="#/">the live explorer</a>
        </div>
      </section>
    </article>
  `;

  const nav = root.querySelector<HTMLElement>('.protocol-nav');
  const buttons = Array.from(nav?.querySelectorAll<HTMLButtonElement>('[data-section]') ?? []);
  const setCurrentSection = (id: string) => {
    for (const button of buttons) {
      if (button.dataset.section === id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  };

  const scrollToSection = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-section]');
    if (!button) return;
    const id = button.dataset.section ?? '';
    const section = document.getElementById(id);
    setCurrentSection(id);
    section?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  nav?.addEventListener('click', scrollToSection);

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
      const id = visible[0]?.target.id;
      if (id) setCurrentSection(id);
    },
    { rootMargin: '-10% 0px -76% 0px' },
  );
  for (const [id] of sections) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }

  return () => {
    nav?.removeEventListener('click', scrollToSection);
    observer.disconnect();
    document.title = previousTitle;
  };
}
