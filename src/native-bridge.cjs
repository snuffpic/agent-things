'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function verifyBridgeBundle(root) {
  const binary = path.join(root, 'native/bin/bridge');
  const manifestFile = path.join(root, 'native/bin/bridge.json');
  if (!fs.existsSync(binary) || !fs.existsSync(manifestFile)) throw new Error('安装包缺少预编译启动桥；源码开发请先运行 npm run build:bridge');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (manifest.protocol !== 1 || manifest.sha256 !== hash(binary)) throw new Error('预编译启动桥校验失败，请重新获取安装包');
  if (manifest.sourceSha256 !== hash(path.join(root, 'native/session-status-bridge.swift'))) throw new Error('启动桥与源码不一致；源码开发请重新运行 npm run build:bridge');
  return binary;
}

module.exports = { verifyBridgeBundle };
