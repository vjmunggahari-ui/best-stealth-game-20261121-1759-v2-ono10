// BLACKOUT: The Meridian Heist — the hand-in program (Node 22, stdlib only).
//
// It takes the game in this repository — the static files under game/ and the
// four screenshots under screenshots/ — copies them to the output directory
// and writes /output/dossier.json with the vendored make.fun library, exactly
// as the sealed scorer rebuilds it. The grader mounts the repository
// read-only, so NOTHING is ever written back into the repo: the output
// directory comes from MAKEFUN_OUTPUT_DIR outside the grader (or /output
// inside it), never from a path under this file.
//
// After writing the dossier it reads the file back and checks it: the JSON
// must parse, name the makefun/dossier/v1 schema, and be byte for byte what
// buildDossier writes from the same directory. If any of that fails the
// program exits non-zero and says so, instead of handing in a broken entry.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   node serve.ts   # then open http://localhost:8080 to play

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps: only text_max_bytes shapes the dossier's bytes; the
// rest refuse an entry the scorer would refuse anyway (more than 4 shots or
// one over 256 KiB; game/ over 993 files or 48 MiB, or a path over 1000 bytes).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

// Start from clean output contents so a stale file can never ride along.
// Only the known children are removed, never the directory itself: the
// grader hands main.ts an /output it may not be allowed to unlink.
for (const child of ['game', 'screenshots', 'dossier.json']) {
  rmSync(join(outDir, child), { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

const dossierBytes = buildDossier(outDir, CAPS);
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);

// ---- Read-back self-check: prove the hand-in is what the scorer rebuilds.
const written = readFileSync(join(outDir, 'dossier.json'));
if (!written.equals(Buffer.from(dossierBytes))) {
  console.error('SELF-CHECK FAILED: dossier.json on disk differs from buildDossier output');
  process.exit(1);
}
const dossier = JSON.parse(written.toString('utf8'));
if (dossier.schema !== 'makefun/dossier/v1') {
  console.error('SELF-CHECK FAILED: unexpected dossier schema: ' + dossier.schema);
  process.exit(1);
}
if (written.length > 1572864) {
  console.error('SELF-CHECK FAILED: dossier.json over 1.5 MiB (' + written.length + ' B)');
  process.exit(1);
}
const shots = readdirSync(join(outDir, 'screenshots')).filter((f) => !f.startsWith('.')).sort();
if (shots.length < 3 || shots.length > 4) {
  console.error('SELF-CHECK FAILED: expected 3-4 screenshots, found ' + shots.length);
  process.exit(1);
}
for (const shot of shots) {
  const bytes = readFileSync(join(outDir, 'screenshots', shot));
  if (bytes.length > 262144) {
    console.error('SELF-CHECK FAILED: screenshot over 256 KiB: ' + shot);
    process.exit(1);
  }
  console.log('shot ' + shot + ' ' + bytes.length + ' B sha256 ' + sha256(bytes).slice(0, 16) + '…');
}
// Extended read-back: every screenshot the dossier carries must decode to
// exactly the file on disk, in order, and the dossier text must carry the
// game's own sources. A dossier that disagrees with the files is not handed in.
if (!Array.isArray(dossier.images) || dossier.images.length !== shots.length) {
  console.error('SELF-CHECK FAILED: dossier carries ' + (dossier.images ? dossier.images.length : 0) + ' images, disk has ' + shots.length);
  process.exit(1);
}
for (let i = 0; i < shots.length; i++) {
  const diskBytes = readFileSync(join(outDir, 'screenshots', shots[i]));
  const dossierBytes = Buffer.from(dossier.images[i].base64, 'base64');
  if (!diskBytes.equals(dossierBytes)) {
    console.error('SELF-CHECK FAILED: dossier image ' + i + ' does not match ' + shots[i] + ' on disk');
    process.exit(1);
  }
}
if (dossier.cover !== 0) {
  console.error('SELF-CHECK FAILED: cover is not the first screenshot');
  process.exit(1);
}
for (const src of ['game/index.html', 'game/levels.js', 'game/game.js', 'game/style.css']) {
  if (!dossier.text.includes('### ' + src)) {
    console.error('SELF-CHECK FAILED: dossier text is missing source ' + src);
    process.exit(1);
  }
}
if (!dossier.text.includes('BLACKOUT') || !dossier.text.includes('The Meridian Heist')) {
  console.error('SELF-CHECK FAILED: dossier text does not name the game');
  process.exit(1);
}
console.log('read-back: all ' + shots.length + ' dossier images match disk, cover is 01-cover.jpg, 4 sources present');
const gameFiles = countFiles(join(outDir, 'game'));
const indexBytes = statSync(join(outDir, 'game', 'index.html')).size;
console.log('BLACKOUT handed in: ' + gameFiles + ' game files, ' + shots.length + ' screenshots, index.html ' + indexBytes + ' B');
console.log('dossier.json ' + written.length + ' B sha256 ' + sha256(written));
console.log('SELF-CHECK PASSED');
