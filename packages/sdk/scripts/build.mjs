// Build pipeline: wasm-pack (seal + verify) -> inline wasm as base64 ->
// tsc -> copy generated glue into dist. Zero bundler config for consumers.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(sdkDir, '..', '..');
const wasmCrate = join(repoRoot, 'crates', 'bte-wasm');

const run = (cmd, cwd = repoRoot) => execSync(cmd, { cwd, stdio: 'inherit' });

const targets = [
  { name: 'seal', outDir: 'pkg-seal', features: '' },
  { name: 'verify', outDir: 'pkg-verify', features: '-- --features verify' },
];

for (const t of targets) {
  if (!process.env.BTE_SKIP_WASM_PACK || !existsSync(join(wasmCrate, t.outDir))) {
    run(`wasm-pack build crates/bte-wasm --target web --release --out-dir ${t.outDir} ${t.features}`);
  }
  const gen = join(sdkDir, 'src', 'generated', t.name);
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });
  const pkg = join(wasmCrate, t.outDir);
  cpSync(join(pkg, 'bte_wasm.js'), join(gen, 'bte_wasm.js'));
  cpSync(join(pkg, 'bte_wasm.d.ts'), join(gen, 'bte_wasm.d.ts'));
  const wasm = readFileSync(join(pkg, 'bte_wasm_bg.wasm'));
  writeFileSync(join(gen, 'wasm-b64.js'), `export default ${JSON.stringify(wasm.toString('base64'))};\n`);
  writeFileSync(join(gen, 'wasm-b64.d.ts'), 'declare const b64: string;\nexport default b64;\n');
}

rmSync(join(sdkDir, 'dist'), { recursive: true, force: true });
run('npx tsc -p tsconfig.json', sdkDir);
cpSync(join(sdkDir, 'src', 'generated'), join(sdkDir, 'dist', 'generated'), { recursive: true });
console.log('bte-sdk build complete');
