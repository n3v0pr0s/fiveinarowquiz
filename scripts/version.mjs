import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(version) {
  if (!versionPattern.test(version)) throw new Error(`Некорректная версия: ${version}`);
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Слишком большой номер версии.');
  return parts;
}

export function nextVersion(current, type) {
  const parts = parseVersion(current);
  const index = ['major', 'minor', 'patch'].indexOf(type);
  if (index === -1) throw new Error('Укажите тип выпуска: major, minor или patch.');
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  const next = parts.join('.');
  parseVersion(next);
  return next;
}

export function stampVersion(html, version) {
  parseVersion(version);
  const replacements = [
    [/<meta name="application-version" content="[^"]*">/g, `<meta name="application-version" content="${version}">`],
    [/<span id="game-version" class="game-version" title="Версия игры">[^<]*<\/span>/g, `<span id="game-version" class="game-version" title="Версия игры">v${version}</span>`],
  ];
  for (const [pattern, replacement] of replacements) {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error('Не найдена однозначная отметка версии в dist/index.html.');
    html = html.replace(pattern, replacement);
  }
  return html;
}

export function addRelease(changelog, version, notes, date = new Date().toISOString().slice(0, 10)) {
  parseVersion(version);
  const lines = notes.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Добавьте описание изменений после типа выпуска.');
  if (changelog.includes(`## [${version}]`)) throw new Error(`Версия ${version} уже есть в CHANGELOG.md.`);
  const firstRelease = changelog.search(/^## \[/m);
  if (firstRelease === -1) throw new Error('Не найдена история версий в CHANGELOG.md.');
  const entry = `## [${version}] - ${date}\n\n${lines.map(line => `- ${line}`).join('\n')}\n\n`;
  return changelog.slice(0, firstRelease) + entry + changelog.slice(firstRelease);
}

async function main() {
  const [type, ...description] = process.argv.slice(2);
  if (!['sync', 'major', 'minor', 'patch'].includes(type)) {
    throw new Error('Использование: npm run release -- <major|minor|patch> "Описание изменений"');
  }
  const packagePath = path.join(root, 'package.json');
  const htmlPath = path.join(root, 'dist', 'index.html');
  const packageText = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(packageText);
  const html = await readFile(htmlPath, 'utf8');
  if (type === 'sync') {
    const updated = stampVersion(html, pkg.version);
    if (updated !== html) await writeFile(htmlPath, updated);
    console.log(`QuizRow v${pkg.version}`);
    return;
  }
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf8');
  const version = nextVersion(pkg.version, type);
  // Prepare and validate every change before touching any files.
  const updatedHtml = stampVersion(html, version);
  const updatedChangelog = addRelease(changelog, version, description.join(' '));
  pkg.version = version;
  const changes = [
    [packagePath, packageText, JSON.stringify(pkg, null, 2) + '\n'],
    [htmlPath, html, updatedHtml],
    [changelogPath, changelog, updatedChangelog],
  ];
  const written = [];
  try {
    for (const change of changes) { written.push(change);await writeFile(change[0], change[2]); }
  } catch (error) {
    for (const [file, previous] of written.reverse()) await writeFile(file, previous);
    throw error;
  }
  console.log(`QuizRow v${version}: обновлены package.json, dist/index.html и CHANGELOG.md.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message);process.exitCode = 1; });
}
