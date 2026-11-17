'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateTag, prepareRelease, checkRelease, checkPublication } = require('../scripts/prepare-release.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'things-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'agent-things', version: '1.1.1', repository: { type: 'git', url: 'git+https://github.com/fixture/agent-things.git' }, files: ['bin/*.cjs'] }));
  fs.writeFileSync(path.join(directory, '.gitignore'), 'dist/\n');
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/prepare-release.cjs', 'skills/things/SKILL.md', 'native/bin/bridge', 'native/bin/bridge.json', 'bin/agent-things.cjs']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), 'fixture');
  }
  git(['init', '-q']); git(['add', '.']);
  const commit = () => git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']);
  commit(); git(['tag', 'v1.1.1']);
  return { directory, output: path.join(directory, 'dist'), git, commit };
}
test('release version tags must match the stable package identity exactly', () => {
  validateTag({ name: 'agent-things', version: '1.1.1' }, 'v1.1.1');
  for (const [name, version, tag] of [['other', '1.1.1', 'v1.1.1'], ['agent-things', '1.1.1', 'v1.1.2'], ['agent-things', '1.1.1-beta.1', 'v1.1.1-beta.1']]) assert.throws(() => validateTag({ name, version }, tag));
});
test('release packaging records the exact tagged commit and verified archive; corruption and extra archives are rejected', t => {
  const { directory, output, git } = fixture(t);
  const release = prepareRelease({ directory, output, tag: 'v1.1.1' });
  const manifest = path.join(output, 'release.json');
  assert.equal(release.commit, git(['rev-parse', 'HEAD']));
  assert.deepEqual(checkRelease(manifest), release);
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
  const other = path.join(output, 'other.tgz'); fs.writeFileSync(other, 'extra');
  assert.throws(() => checkRelease(manifest), /额外/); fs.unlinkSync(other);
  fs.appendFileSync(path.join(output, release.filename), 'changed');
  assert.throws(() => checkRelease(manifest), /已被修改/);
});
test('dirty, differently tagged and reused release outputs fail before publishing', t => {
  const { directory, output, git, commit } = fixture(t);
  const untracked = path.join(directory, 'unexpected.cjs'); fs.writeFileSync(untracked, 'fixture');
  assert.throws(() => prepareRelease({ directory, output, tag: 'v1.1.1' }), /未提交/);
  git(['add', '.']); commit();
  assert.throws(() => prepareRelease({ directory, output, tag: 'v1.1.1' }), /没有指向/);
  git(['tag', '-f', 'v1.1.1']); fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'old'), 'fixture');
  assert.throws(() => prepareRelease({ directory, output, tag: 'v1.1.1' }), /必须为空/);
});
test('CI command references and packaging inputs are present in the source candidate', () => {
  const root = path.resolve(__dirname, '..'), pkg = require('../package.json');
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  for (const script of ['verify', 'check:syntax', 'check:browser', 'check:package', 'build:bridge', 'build:bundles']) assert.ok(pkg.scripts[script], script);
  assert.match(ci, /run: npm run verify/);
  assert.ok(pkg.scripts.verify.indexOf('npm test') < pkg.scripts.verify.indexOf('check:package'));
  assert.match(release, /needs: verify/);
  assert.match(release, /github.event_name == 'workflow_dispatch' && inputs.publish/);
  assert.match(release, /npm publish \.\/dist\/\*\.tgz --ignore-scripts/);
  for (const file of ['scripts/prepare-release.cjs', 'scripts/check.cjs', 'scripts/acceptance/fresh-install-terminal.py', 'scripts/acceptance/fresh-install-preload.cjs']) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test('publication requires the matching GitHub tag, repository and checked out commit', t => {
  const { directory, output, git, commit } = fixture(t);
  const release = prepareRelease({ directory, output, tag: 'v1.1.1' });
  const file = path.join(output, 'release.json');
  const options = { directory, repository: 'fixture/agent-things', ref: 'refs/tags/v1.1.1' };
  assert.deepEqual(checkPublication(file, options), release);
  assert.throws(() => checkPublication(file, { ...options, ref: 'refs/heads/main' }), /版本标签/);
  assert.throws(() => checkPublication(file, { ...options, repository: 'other/agent-things' }), /repository/);
  fs.writeFileSync(path.join(directory, 'changed'), 'new source'); git(['add', 'changed']); commit();
  assert.throws(() => checkPublication(file, options), /提交/);
});
