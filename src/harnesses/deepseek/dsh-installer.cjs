'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BUNDLE_NAME = 'agent-things-dsh';
const MIN_NODE_MAJOR = 24;
const MIN_NODE_MINOR = 9;

function parseNodeSemver(raw) {
  const match = String(raw || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function isCompatibleNode(versionStr) {
  const parsed = parseNodeSemver(versionStr);
  if (!parsed) return false;
  return parsed.major > MIN_NODE_MAJOR || (parsed.major === MIN_NODE_MAJOR && parsed.minor >= MIN_NODE_MINOR);
}

function inspectProfileBundleLink(profileDir, profileName, pkg) {
  const depSpec = pkg?.dependencies?.[BUNDLE_NAME];
  const hasDep = typeof depSpec === 'string' && depSpec.length > 0;
  const inBundles = Boolean(pkg?.dsh?.profile?.bundles?.includes(BUNDLE_NAME));
  if (!hasDep && !inBundles) return null;

  let linkPath = null;
  if (typeof depSpec === 'string' && depSpec.startsWith('link:')) {
    const rawTarget = depSpec.slice(5);
    linkPath = path.isAbsolute(rawTarget) ? path.resolve(rawTarget) : path.resolve(profileDir, rawTarget);
  } else if (fs.existsSync(path.join(profileDir, 'node_modules', BUNDLE_NAME))) {
    linkPath = path.join(profileDir, 'node_modules', BUNDLE_NAME);
  }

  let valid = false;
  let version = null;
  let error = null;

  if (!inBundles) {
    error = 'not-in-bundles';
  } else if (!linkPath) {
    error = 'missing-link';
  } else if (!fs.existsSync(linkPath)) {
    error = 'missing-target';
  } else {
    try {
      validateBundleDir(linkPath);
      const bundlePkg = JSON.parse(fs.readFileSync(path.join(linkPath, 'package.json'), 'utf8'));
      version = bundlePkg?.version ? String(bundlePkg.version) : null;
      valid = true;
    } catch {
      error = 'missing-files';
    }
  }

  return {
    profile: profileName,
    spec: depSpec || null,
    linkPath,
    valid,
    version,
    error,
  };
}

function probeDshRuntime({ env = process.env, home = os.homedir(), execFn = execFileSync } = {}) {
  const candidates = [];
  const pathDirs = String(env?.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    candidates.push(path.join(dir, 'dsh'));
  }

  // Probe common Node version manager locations (fnm, nvm, Homebrew)
  const fnmDir = path.join(home, '.local/share/fnm/node-versions');
  if (fs.existsSync(fnmDir)) {
    try {
      const versions = fs.readdirSync(fnmDir).sort().reverse();
      for (const ver of versions) {
        candidates.push(path.join(fnmDir, ver, 'installation/bin/dsh'));
      }
    } catch { /* ignore */ }
  }
  const nvmDir = path.join(home, '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).sort().reverse();
      for (const ver of versions) {
        candidates.push(path.join(nvmDir, ver, 'bin/dsh'));
      }
    } catch { /* ignore */ }
  }
  candidates.push('/opt/homebrew/bin/dsh', '/usr/local/bin/dsh');

  const seen = new Set();
  let binary = null;
  let nodeBinDir = null;
  let nodeVersion = null;
  let nodeCompatible = null;
  let fallback = null;

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!fs.existsSync(resolved)) continue;

    const binDir = path.dirname(resolved);
    const siblingNode = path.join(binDir, 'node');
    let ver = null;
    if (fs.existsSync(siblingNode)) {
      try {
        ver = execFn(siblingNode, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
      } catch { /* ignore */ }
    } else {
      try {
        ver = execFn('node', ['--version'], { env: buildDshExecEnv(binDir, env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
      } catch { /* ignore */ }
    }
    if (ver && isCompatibleNode(ver)) {
      binary = resolved;
      nodeBinDir = binDir;
      nodeVersion = ver;
      nodeCompatible = true;
      break;
    }
    if (!fallback) {
      fallback = { resolved, binDir, ver: ver || null };
    }
  }

  if (!binary && fallback) {
    binary = fallback.resolved;
    nodeBinDir = fallback.binDir;
    nodeVersion = fallback.ver;
    nodeCompatible = fallback.ver ? isCompatibleNode(fallback.ver) : null;
  }

  const dshHome = env?.DSH_HOME && env.DSH_HOME.trim()
    ? path.resolve(env.DSH_HOME.trim())
    : path.join(home, '.dsh');

  const profiles = [];
  const pluginProfiles = [];
  const profileLinks = [];
  const profilesDir = path.join(dshHome, 'profiles');
  if (fs.existsSync(profilesDir)) {
    try {
      for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const profileDir = path.join(profilesDir, entry.name);
        const pkgPath = path.join(profileDir, 'package.json');
        if (!fs.existsSync(pkgPath)) continue;
        profiles.push(entry.name);
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const linkInfo = inspectProfileBundleLink(profileDir, entry.name, pkg);
          if (linkInfo) {
            pluginProfiles.push(entry.name);
            profileLinks.push(linkInfo);
          }
        } catch { /* ignore malformed profile manifest */ }
      }
    } catch { /* ignore */ }
  }

  const healthyPluginProfiles = profileLinks.filter(item => item.valid).map(item => item.profile);
  const brokenPluginProfiles = profileLinks.filter(item => !item.valid).map(item => item.profile);

  return {
    installed: Boolean(binary),
    binary,
    nodeBinDir,
    nodeVersion,
    nodeCompatible,
    dshHome,
    profiles,
    pluginProfiles,
    profileLinks,
    healthyPluginProfiles,
    brokenPluginProfiles,
    bundleReady: healthyPluginProfiles.length > 0,
    pluginInstalled: pluginProfiles.length > 0,
  };
}

function buildDshExecEnv(nodeBinDir, env = process.env) {
  if (!nodeBinDir) return { ...env };
  const currentPath = env?.PATH || '';
  return {
    ...env,
    PATH: currentPath ? `${nodeBinDir}${path.delimiter}${currentPath}` : nodeBinDir,
  };
}

function backupProfilePackage(pkgPath) {
  if (!fs.existsSync(pkgPath)) return null;
  const bakPath = `${pkgPath}.bak`;
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(pkgPath, bakPath);
  }
  return bakPath;
}

function validateBundleDir(bundleDir) {
  const pkgPath = path.join(bundleDir, 'package.json');
  const patchPath = path.join(bundleDir, 'cordis.patch.yml');
  const hostEntry = path.join(bundleDir, 'lib/index.js');
  const clientEntry = path.join(bundleDir, 'lib/client.js');
  for (const required of [pkgPath, patchPath, hostEntry, clientEntry]) {
    if (!fs.existsSync(required)) {
      throw new Error(`DeepSeek Harness bundle file missing: ${required}`);
    }
  }
}

function installDshPlugin({
  bundleDir,
  profiles = null,
  env = process.env,
  home = os.homedir(),
  execFn = execFileSync,
} = {}) {
  validateBundleDir(bundleDir);
  const runtime = probeDshRuntime({ env, home, execFn });
  if (!runtime.binary) {
    throw new Error('dsh CLI not found; install @deepseek-ai/dsh (Node >= 24.9) first');
  }
  if (runtime.nodeCompatible === false) {
    throw new Error(`DeepSeek Harness requires Node >= v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0 (detected ${runtime.nodeVersion || 'unknown'} alongside ${runtime.binary})`);
  }

  const execEnv = buildDshExecEnv(runtime.nodeBinDir, env);
  const targetProfiles = Array.isArray(profiles) && profiles.length
    ? profiles
    : (runtime.profiles.length ? runtime.profiles : ['web']);
  const expectedBundlePath = path.resolve(bundleDir);
  let expectedBundleRealpath = expectedBundlePath;
  try { expectedBundleRealpath = fs.realpathSync(expectedBundlePath); } catch { /* ignore */ }

  const installed = [];
  for (const profile of targetProfiles) {
    const profileDir = path.join(runtime.dshHome, 'profiles', profile);
    const pkgPath = path.join(profileDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      execFn(runtime.binary, ['--profile', profile, '--dump-config'], {
        env: execEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });
    }
    backupProfilePackage(pkgPath);
    execFn(runtime.binary, ['plugin', '--profile', profile, 'add', `link:${expectedBundlePath}`], {
      env: execEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const depSpec = updatedPkg?.dependencies?.[BUNDLE_NAME];
    let hasValidDep = false;
    if (typeof depSpec === 'string' && depSpec.startsWith('link:')) {
      const linkedTarget = path.resolve(depSpec.slice(5));
      let linkedRealpath = linkedTarget;
      try { linkedRealpath = fs.realpathSync(linkedTarget); } catch { /* ignore */ }
      hasValidDep = linkedTarget === expectedBundlePath || linkedRealpath === expectedBundleRealpath;
    }
    const hasBundle = Boolean(updatedPkg?.dsh?.profile?.bundles?.includes(BUNDLE_NAME));
    if (!hasValidDep || !hasBundle) {
      throw new Error(`Failed to register ${BUNDLE_NAME} into DeepSeek Harness profile "${profile}"`);
    }
    installed.push(profile);
  }
  return { dshHome: runtime.dshHome, binary: runtime.binary, profiles: installed };
}

function uninstallDshPlugin({
  profiles = null,
  env = process.env,
  home = os.homedir(),
  execFn = execFileSync,
} = {}) {
  const runtime = probeDshRuntime({ env, home, execFn });
  const targetProfiles = Array.isArray(profiles) && profiles.length ? profiles : runtime.pluginProfiles;
  const removed = [];
  const execEnv = buildDshExecEnv(runtime.nodeBinDir, env);

  for (const profile of targetProfiles) {
    const pkgPath = path.join(runtime.dshHome, 'profiles', profile, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    backupProfilePackage(pkgPath);
    let cliSucceeded = false;
    if (runtime.binary) {
      try {
        execFn(runtime.binary, ['plugin', '--profile', profile, 'remove', BUNDLE_NAME], {
          env: execEnv,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000,
        });
        cliSucceeded = true;
      } catch { /* fall back to direct manifest cleanup */ }
    }
    if (!cliSucceeded && fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dependencies) delete pkg.dependencies[BUNDLE_NAME];
      if (Array.isArray(pkg.dsh?.profile?.bundles)) {
        pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(name => name !== BUNDLE_NAME);
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
    removed.push(profile);
  }
  return { dshHome: runtime.dshHome, removed };
}

module.exports = {
  BUNDLE_NAME,
  isCompatibleNode,
  inspectProfileBundleLink,
  probeDshRuntime,
  buildDshExecEnv,
  installDshPlugin,
  uninstallDshPlugin,
};
