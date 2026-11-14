'use strict';
const path = require('node:path');
const commands = new Set(['setup', 'doctor', 'help', '--help', '-h', 'run', 'status', 'mcp', 'install-mcp', 'disable-mcp', 'update-renderer', 'install-autostart', 'disable-autostart']);
function parseArguments(raw) {
  const args = [...raw];
  const command = !args.length || ['--all', '-y', '--yes'].includes(args[0]) ? 'setup' : args.shift();
  if (!commands.has(command)) throw new Error(`未知命令：${command}`);
  const options = { command, port: 39222, watchStartup: false };
  while (args.length) {
    const flag = args.shift();
    if (command === 'setup' && ['--all', '-y', '--yes'].includes(flag)) options.yes = true;
    else if (command === 'setup' && flag === '--lang') {
      options.lang = args.shift();
      if (!['zh', 'en'].includes(options.lang)) throw new Error('--lang 应为 zh 或 en');
    } else if (['--help', '-h'].includes(flag)) options.command = 'help';
    else if (flag === '--port' && ['run', 'status', 'mcp'].includes(command)) {
      options.port = Number(args.shift());
      if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('调试端口无效');
    } else if (flag === '--watch-startup' && command === 'run') options.watchStartup = true;
    else if (flag === '--data-dir' && ['run', 'status', 'mcp', 'update-renderer', 'install-autostart'].includes(command)) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error('--data-dir 需要目录路径');
      options.directory = path.resolve(value);
    } else throw new Error(`命令 ${command} 不支持选项：${flag}`);
  }
  return options;
}
module.exports = { parseArguments };
