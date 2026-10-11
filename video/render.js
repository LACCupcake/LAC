// Renders scene.html frame-by-frame (in parallel browser pages) and encodes it with ffmpeg.
// Usage: node render.js [out.mp4] [fps] [workers]   |   node render.js --stills 1,3,5 [dir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');

async function openScene(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'scene.html') + '?capture');
  await page.evaluate(() => document.fonts.ready);
  return page;
}

(async () => {
  const args = process.argv.slice(2);
  const browser = await chromium.launch();

  if (args[0] === '--stills') {
    const page = await openScene(browser);
    for (const t of args[1].split(',').map(Number)) {
      await page.evaluate(t => render(t), t);
      await page.screenshot({ path: path.join(args[2] || '.', `still_${t}.png`) });
    }
    await browser.close(); return;
  }

  const out = path.resolve(args[0] || 'lac-teams-intro.mp4');
  const fps = Number(args[1] || 60);
  const workers = Number(args[2] || Math.max(1, os.cpus().length));
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lac-frames-'));
  const first = await openScene(browser);
  const total = Math.round((await first.evaluate(() => window.DURATION)) * fps);
  const pages = [first, ...await Promise.all(Array.from({ length: workers - 1 }, () => openScene(browser)))];

  let next = 0, done = 0;
  await Promise.all(pages.map(async page => {
    while (next < total) {
      const i = next++;
      await page.evaluate(t => render(t), i / fps);
      await page.screenshot({ path: path.join(frameDir, `f${String(i).padStart(5, '0')}.png`) });
      if (++done % 60 === 0) console.log(`frame ${done}/${total}`);
    }
  }));
  await browser.close();

  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frameDir, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  fs.rmSync(frameDir, { recursive: true, force: true });
  console.log('done →', out);
})();
