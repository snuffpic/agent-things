'use strict';
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('isolated Claude install, reinstall, rollback and disable preserve the ledger and other integrations', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-things-claude-install-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  execFileSync(process.execPath, ['-e', `
    const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const launchd=require('./src/launchd.cjs'),services=new Map();
    launchd.printJob=label=>services.has(label)?'running':null;
    launchd.bootout=async label=>services.delete(label);
    launchd.bootstrap=file=>{assert.ok(fs.existsSync(file));services.set(path.basename(file,'.plist'),file)};
    const {executeSetup,uninstallAll,DATA_DIR}=require('./src/cli/setup-orchestrator.cjs');
    const config=path.join(process.env.HOME,'.claude.json');
    fs.writeFileSync(config,JSON.stringify({theme:'dark',mcpServers:{keep:{command:'keep'}}}));
    const state=require('./src/harnesses/claude/claude-service.cjs').DEFAULT_STATE_FILE;
    fs.mkdirSync(path.dirname(state),{recursive:true});
    fs.writeFileSync(state,JSON.stringify({version:1,revision:0,records:{}}));
    const before=fs.readFileSync(state,'utf8');
    (async()=>{
      for(let n=0;n<2;n++){
        await executeSetup({enabledApps:['claude']});
        assert.equal(services.size,1);assert.ok(services.has('com.agentthings.claude'));
        assert.ok(fs.existsSync(path.join(DATA_DIR,'runtime/src/harnesses/claude/claude-host-helper.cjs')));
        assert.ok(fs.existsSync(path.join(process.env.HOME,'.claude/skills/agent-things/SKILL.md')));
        assert.equal(JSON.parse(fs.readFileSync(config)).mcpServers.keep.command,'keep');
      }
      const saved=fs.readFileSync(config,'utf8');
      await assert.rejects(executeSetup({enabledApps:['claude'],verify:async()=>{throw new Error('verify failed')}}),/verify failed/);
      assert.equal(services.size,1);assert.equal(fs.readFileSync(config,'utf8'),saved);
      assert.equal(fs.readFileSync(state,'utf8'),before);
      await executeSetup({enabledApps:[]});assert.equal(services.size,0);
      assert.deepEqual(JSON.parse(fs.readFileSync(config)).mcpServers,{keep:{command:'keep'}});
      assert.equal(fs.readFileSync(state,'utf8'),before);
      await uninstallAll();assert.equal(fs.readFileSync(state,'utf8'),before);
    })().catch(error=>{console.error(error);process.exitCode=1});
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, HOME: home }, stdio: 'pipe', timeout: 30000 });
});
