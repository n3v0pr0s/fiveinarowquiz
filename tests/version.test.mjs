import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nextVersion, stampVersion, addRelease } from '../scripts/version.mjs';

const html = '<meta name="application-version" content="0.1.0"><span id="game-version" class="game-version" title="Версия игры">v0.1.0</span>';
const history = '# QuizRow\n\n## [0.1.0] - 2026-10-31\n\n- Первая версия.\n';

test('Release increments follow major.minor.patch and reject invalid inputs', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.7', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.2.7', 'major'), '1.0.0');
  assert.throws(() => nextVersion('0.01.0', 'patch'));
  assert.throws(() => nextVersion('0.1.0', 'latest'));
  assert.throws(() => nextVersion('0.1.9007199254740991', 'patch'));
});

test('The visible version and metadata are updated together without changing other content', () => {
  const updated = stampVersion(html + '<h1>QuizRow</h1>', '0.2.0');
  assert(updated.includes('content="0.2.0"'));
  assert(updated.includes('>v0.2.0</span>'));
  assert(updated.endsWith('<h1>QuizRow</h1>'));
  assert.throws(() => stampVersion('<html></html>', '0.2.0'));
  assert.throws(() => stampVersion(html + html, '0.2.0'));
});

test('A release prepends meaningful notes and preserves previous versions', () => {
  const updated = addRelease(history, '0.1.1', 'Исправлен таймер.\nУлучшен звук.', '2026-11-01');
  assert(updated.includes('## [0.1.1] - 2026-11-01\n\n- Исправлен таймер.\n- Улучшен звук.'));
  assert(updated.endsWith(history.slice(history.indexOf('## ['))));
  assert.throws(() => addRelease(history, '0.1.0', 'Повтор.'));
  assert.throws(() => addRelease(history, '0.1.1', '  '));
});

test('The CLI updates all release files; a missing description leaves them unchanged', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'quizrow-version-'));
  const files = ['scripts/version.mjs', 'package.json', 'dist/index.html', 'CHANGELOG.md'];
  try {
    await mkdir(path.join(fixture, 'scripts'));await mkdir(path.join(fixture, 'dist'));
    await writeFile(path.join(fixture, files[0]), await readFile(new URL('../scripts/version.mjs', import.meta.url)));
    await writeFile(path.join(fixture, files[1]), JSON.stringify({ version: '0.1.0' }));
    await writeFile(path.join(fixture, files[2]), html);
    await writeFile(path.join(fixture, files[3]), history);
    const release = spawnSync(process.execPath, [path.join(fixture, files[0]), 'minor', 'Добавлен режим.'], { encoding: 'utf8' });
    assert.equal(release.status, 0, release.stderr);
    assert.equal(JSON.parse(await readFile(path.join(fixture, files[1]), 'utf8')).version, '0.2.0');
    assert((await readFile(path.join(fixture, files[2]), 'utf8')).includes('>v0.2.0</span>'));
    assert((await readFile(path.join(fixture, files[3]), 'utf8')).includes('## [0.2.0]'));
    const before = [];
    for (const file of files.slice(1)) before.push(await readFile(path.join(fixture, file), 'utf8'));
    const invalid = spawnSync(process.execPath, [path.join(fixture, files[0]), 'patch'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    for (const [index, file] of files.slice(1).entries()) assert.equal(await readFile(path.join(fixture, file), 'utf8'), before[index]);
  } finally {
    for (const file of files) await unlink(path.join(fixture, file)).catch(error => { if(error.code !== 'ENOENT') throw error; });
    await rmdir(path.join(fixture, 'scripts')).catch(error => { if(error.code !== 'ENOENT') throw error; });
    await rmdir(path.join(fixture, 'dist')).catch(error => { if(error.code !== 'ENOENT') throw error; });
    await rmdir(fixture);
  }
});

test('The shipped game, package version and changelog agree', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const page = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const log = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.equal(stampVersion(page, pkg.version), page);
  assert(log.includes(`## [${pkg.version}]`));
});
