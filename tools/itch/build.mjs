// Builds the itch.io uploads from play/index.html:
//   dist/itch/choirbreaker-demo.zip   the browser demo (sectors 1-4), uploaded as "This file will be played in the browser"
//   dist/itch/choirbreaker-full.zip   the paid download, every sector open
//   dist/itch/cover.png               630x500 cover image, and screenshots at 1920x1080
//   node tools/itch/build.mjs
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), dist = join(root, 'dist', 'itch');
const game = await readFile(join(root, 'play', 'index.html'), 'utf8');
const LINE = "const EDITION = 'web';";
if (!game.includes(LINE)) throw new Error(`play/index.html no longer has the line ${LINE}`);

const TAR = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.error || r.status) throw new Error(`${cmd} failed`); };
const zip = (folder, file) => run(TAR, ['-a', '-c', '-f', file, '-C', dirname(folder), folder.split(/[\\/]/).pop()]);

await rm(dist, { recursive: true, force: true });
for (const edition of ['demo', 'full']) {
  const folder = join(dist, edition, edition === 'full' ? 'Choirbreaker' : 'choirbreaker-demo');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.html'), game.replace(LINE, `const EDITION = 'itch-${edition}';`));
  if (edition === 'full') await writeFile(join(folder, 'README.txt'), [
    "Choirbreaker: Humanity's Last Stand",
    '',
    'Open index.html in Chrome, Edge or Firefox to play. No install and no internet needed.',
    'Your progress saves in the browser automatically. Keep this folder where it is: in Firefox, moving it starts a fresh save.',
    '',
    'Coming from the browser demo? In the demo, press Esc, then COPY SAVE CODE. Here, press Esc,',
    'paste the code into the box and press LOAD SAVE CODE.',
    '',
  ].join('\r\n'));
  // itch's browser player needs index.html at the top of the zip; the download keeps it inside a named folder.
  if (edition === 'demo') run(TAR, ['-a', '-c', '-f', join(dist, 'choirbreaker-demo.zip'), '-C', folder, 'index.html']);
  else zip(folder, join(dist, 'choirbreaker-full.zip'));
}

// An unlocked copy on the site for testing the full game; hidden from search engines, but anyone with the link can play.
const testDir = join(root, 'play', 'testingzaqwsxcde');
await mkdir(testDir, { recursive: true });
await writeFile(join(testDir, 'index.html'), game.replace(LINE, "const EDITION = 'itch-full';").replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="robots" content="noindex, nofollow">'));

// Cover (630x500, itch's size) and screenshots, cut from the landing page art.
const ff = (args) => run('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
ff(['-i', join(root, 'img', 'hero.jpg'), '-vf', "crop=iw*0.62:ih*0.66:iw*0.02:ih*0.08,scale=630:500:force_original_aspect_ratio=increase,crop=630:500,drawbox=x=0:y=ih-190:w=iw:h=190:color=black@0.62:t=fill,drawtext=text='CHOIRBREAKER':fontfile='C\\:/Windows/Fonts/consolab.ttf':fontsize=58:fontcolor=white:x=(w-tw)/2:y=h-150:shadowcolor=0x75edff:shadowx=0:shadowy=0:borderw=2:bordercolor=0x14394a,drawtext=text='HUMANITY’S LAST STAND':fontfile='C\\:/Windows/Fonts/consola.ttf':fontsize=20:fontcolor=0xffb35c:x=(w-tw)/2:y=h-80", join(dist, 'cover.png')]);
for (const shot of ['hero', 'shot1', 'shot2', 'shot3', 'shot4']) await copyFile(join(root, 'img', `${shot}.jpg`), join(dist, `screenshot-${shot}.jpg`));
console.log(`Built ${dist}`);
