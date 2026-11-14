'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
function validateTag(pkg, tag) {
  if (pkg.name !== 'agent-things' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) throw new Error('发布包名称或稳定版本无效');
  if (tag !== `v${pkg.version}`) throw new Error('发布标签与 package.json 版本不匹配');
}
function prepareRelease({ directory = root, tag, output = path.join(directory, 'dist') }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  validateTag(pkg, tag);
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]) !== commit) throw new Error('发布标签没有指向当前提交');
  if (git(['status', '--porcelain=v1']).length) throw new Error('发布源目录存在未提交内容');
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/prepare-release.cjs', 'skills/things/SKILL.md', 'native/bin/bridge', 'native/bin/bridge.json']) git(['ls-files', '--error-unmatch', file]);
  fs.mkdirSync(output, { recursive: true });
  if (fs.readdirSync(output).length) throw new Error('发布输出目录必须为空');
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.resolve(output)], { cwd: directory, encoding: 'utf8' }));
  const filename = `${pkg.name}-${pkg.version}.tgz`;
  if (pack.filename !== filename) throw new Error('发布文件名不匹配');
  const archive = fs.readFileSync(path.join(output, filename));
  const integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`;
  if (pack.integrity !== integrity) throw new Error('npm 包校验值不匹配');
  const manifest = { package: pkg.name, version: pkg.version, tag, commit, filename, sha256: digest(archive), integrity };
  fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${manifest.sha256}  ${filename}\n`);
  return manifest;
}
function checkRelease(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateTag({ name: manifest.package, version: manifest.version }, manifest.tag);
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.filename !== `${manifest.package}-${manifest.version}.tgz`) throw new Error('发布清单无效');
  const directory = path.dirname(file);
  const archives = fs.readdirSync(directory).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1 || archives[0] !== manifest.filename) throw new Error('发布目录包含额外或缺失的安装包');
  const bytes = fs.readFileSync(path.join(directory, manifest.filename));
  if (digest(bytes) !== manifest.sha256 || `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== manifest.integrity) throw new Error('发布安装包已被修改');
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8') !== `${manifest.sha256}  ${manifest.filename}\n`) throw new Error('发布摘要文件不匹配');
  return manifest;
}
function checkPublication(file, { directory = root, repository = process.env.GITHUB_REPOSITORY, ref = process.env.GITHUB_REF } = {}) {
  const manifest = checkRelease(file);
  if (!repository || ref !== `refs/tags/${manifest.tag}`) throw new Error('正式发布必须从对应版本标签运行');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  if (manifest.commit !== commit) throw new Error('安装包提交与发布工作区不一致');
  const archive = path.join(path.dirname(file), manifest.filename);
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  validateTag(pkg, manifest.tag);
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (url !== `git+https://github.com/${repository}.git` && url !== `https://github.com/${repository}.git` && url !== `https://github.com/${repository}`) throw new Error('安装包 repository 必须与发布所在 GitHub 仓库一致');
  return manifest;
}
if (require.main === module) {
  try {
    const [command, value, output] = process.argv.slice(2);
    const result = command === 'prepare' ? prepareRelease({ tag: value, output: path.resolve(output || 'dist') })
      : command === 'publish-check' && value ? checkPublication(value)
      : command === 'check' && value ? checkRelease(value) : (() => { throw new Error('用法：prepare-release prepare <tag> <empty-output> | check <release.json>'); })();
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateTag, prepareRelease, checkRelease, checkPublication };
