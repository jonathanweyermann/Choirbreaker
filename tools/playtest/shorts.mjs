// Records vertical gameplay clips for YouTube Shorts, TikTok and Reels. The autopilot flies each sector in combat mode
// with damage off, so it fights what it meets and never dies. Quiet flying is skipped at full speed; when a fight starts,
// the game is stepped one frame at a time and every frame saved, so the video is smooth however slow the machine is.
//   node shorts.mjs --sectors 1-12                         up to 2 clips per sector, 30 s each
//   node shorts.mjs --sectors 8 --clips 3 --seconds 45 --out out/shorts
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '..', '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const [from, to = from] = arg('sectors', '1-6').split('-').map(Number);
const out = resolve(here, arg('out', 'out/shorts'));
const clipsPer = Number(arg('clips', 2)), seconds = Number(arg('seconds', 30)), FPS = 30;
const scale = Number(arg('scale', 2)); // CSS 540x960 at 2x = 1080x1920
const maxFlight = Number(arg('limit', 600));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try { const body = await readFile(path); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

async function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const builds = (await readdir(base)).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
  for (const b of builds) for (const exe of [join(base, b, 'chrome-win64', 'chrome.exe'), join(base, b, 'chrome-win', 'chrome.exe')]) if (existsSync(exe)) return exe;
}
const browser = await chromium.launch({ executablePath: await chromePath(), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: scale });
page.on('pageerror', e => console.log('page error:', String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/play/index.html?debug`);
await page.waitForFunction(() => window.radix && window.radix.level, null, { timeout: 60000 });
await page.waitForTimeout(2500);
await page.addScriptTag({ content: await readFile(join(here, 'autopilot.js'), 'utf8') });
// A clean frame for video: no keyboard hints, and the brand without its FLIGHT TEST tag.
await page.addStyleTag({ content: '.controls { display: none !important; }' });
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// Is a fight on? The autopilot has picked a foe, or something live is close and the guns are going.
const action = () => page.evaluate(() => {
  const R = window.radix, S = window.autopilot.state(), p = R.ship.position;
  const near = R.enemies.filter(e => e.hp > 0 && Math.hypot(e.position[0] - p[0], e.position[1] - p[1], e.position[2] - p[2]) < 45).length;
  return { fight: !!S.fightFoe || (R.firing && near > 0), near, done: S.done, t: S.t };
});

await mkdir(out, { recursive: true });
for (let sector = from; sector <= to; sector++) {
  const info = await page.evaluate(i => { const r = window.autopilot.begin(i, 'combat'); window.radix.debugFlags.god = true; return r; }, sector - 1);
  const slug = `${String(sector).padStart(2, '0')}-${info.title.toLowerCase().replace(/\W+/g, '-')}`;
  console.log(`\nSector ${sector} ${info.title}`);
  let clip = 0, lastClipEnd = -99;
  while (clip < clipsPer) {
    // Fast-forward to the next fight, at least 10 s after the last clip.
    let a;
    for (;;) {
      const r = await page.evaluate(() => window.autopilot.run(0.5, 1e9, 1e9));
      a = await action();
      if (r.done || a.done || a.t > maxFlight) break;
      if (a.fight && a.t - lastClipEnd > 10) break;
    }
    if (a.done || a.t > maxFlight) break;
    clip++;
    const dir = join(out, `${slug}-${clip}`);
    await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
    let n = 0, busy = 0;
    await page.evaluate(s => window.radix.recordAudio(s), seconds);
    for (; n < seconds * FPS; n++) {
      const r = await page.evaluate(dt => window.autopilot.run(dt, 1e9, 1e9), 1 / FPS);
      await frame();
      await page.screenshot({ path: join(dir, `f${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (n % FPS === 0) { const s = await action(); if (s.fight) busy++; if (s.done) { n++; break; } }
    }
    lastClipEnd = (await action()).t;
    const wav = join(dir, 'sound.wav');
    await writeFile(wav, Buffer.from(await page.evaluate(() => window.radix.finishAudio()), 'base64'));
    const mp4 = join(out, `${slug}-${clip}.mp4`);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%05d.jpg'), '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-vf', 'scale=1080:1920:flags=lanczos', '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-14:TP=-1', '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    await rm(dir, { recursive: true, force: true });
    console.log(`  clip ${clip}: ${(n / FPS).toFixed(1)}s, fighting ${busy}/${Math.ceil(n / FPS)} s -> ${mp4}`);
  }
}
await browser.close(); server.close();
