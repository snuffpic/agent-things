'use strict';
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('isolated home installs without developer tools, reinstalls and uninstalls while preserving both ledgers and unrelated config', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-things-install-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  execFileSync(process.execPath, ['-e', `
    const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const childProcess=require('node:child_process');
    const executeFile=childProcess.execFileSync;
    childProcess.execFileSync=(file,...args)=>{
      assert.ok(!['swiftc','xcrun','xcodebuild','xcode-select','lipo','codesign'].includes(path.basename(file)),'Install must use the bundled bridge: '+file);
      return executeFile(file,...args);
    };
    const home=process.env.HOME;
    const launchd=require('./src/launchd.cjs');
    const services=new Map();
    launchd.printJob=label=>services.has(label)?'running':null;
    launchd.bootout=async label=>{services.delete(label)};
    launchd.bootstrap=file=>{assert.ok(fs.existsSync(file));services.set(path.basename(file,'.plist'),file)};
    const {executeSetup,uninstallAll,DATA_DIR}=require('./src/cli/setup-orchestrator.cjs');
    const config=path.join(home,'.codex/config.toml');fs.mkdirSync(path.dirname(config),{recursive:true});
    fs.writeFileSync(config,'model = "example"\\n');
    const agyConfig=path.join(home,'.gemini/antigravity/mcp_config.json');fs.mkdirSync(path.dirname(agyConfig),{recursive:true});
    fs.writeFileSync(agyConfig,JSON.stringify({mcpServers:{unrelated:{command:'keep'}}}));
    const ledgers=[path.join(DATA_DIR,'manual-state.json'),path.join(home,'.gemini/antigravity/session-status/manual-state.json')];
    for(const file of ledgers){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:1,revision:0,records:{}})+'\\n')}
    const before=ledgers.map(f=>fs.readFileSync(f,'utf8'));
    (async()=>{
      for(let n=0;n<2;n++){
        await executeSetup({enabledApps:['codex','antigravity'],autoRestartCodex:false});
        assert.equal(services.size,2);
        assert.ok(fs.existsSync(path.join(DATA_DIR,'bridge')));
        assert.ok(fs.existsSync(path.join(DATA_DIR,'runtime/bin/antigravity-session-status.cjs')));
        const agy=JSON.parse(fs.readFileSync(agyConfig));
        assert.ok(agy.mcpServers.session_status.args[0].startsWith(DATA_DIR));
        assert.equal(agy.mcpServers.unrelated.command,'keep');
        assert.match(fs.readFileSync(config,'utf8'),/mcp_servers.session_status/);
        assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),before);
      }
      await executeSetup({enabledApps:['antigravity']});
      assert.equal(services.size,1);
      assert.ok(!services.has('com.codexsessionstatus.agent'));
      assert.ok(!fs.readFileSync(config,'utf8').includes('[mcp_servers.session_status]'));
      assert.ok(!fs.existsSync(path.join(home,'.codex/skills/agent-things/SKILL.md')));
      await executeSetup({enabledApps:[]});
      assert.equal(services.size,0);
      assert.deepEqual(JSON.parse(fs.readFileSync(agyConfig)).mcpServers,{unrelated:{command:'keep'}});
      await executeSetup({enabledApps:['codex','antigravity']});
      const configBefore=fs.readFileSync(config,'utf8');
      const agyBefore=fs.readFileSync(agyConfig,'utf8');
      const marker=path.join(DATA_DIR,'runtime/rollback-marker');fs.writeFileSync(marker,'old-runtime');
      const bootstrap=launchd.bootstrap;let fail=true;
      launchd.bootstrap=file=>{if(fail&&file.includes('com.antigravity.')){fail=false;throw new Error('simulated bootstrap failure')}bootstrap(file)};
      await assert.rejects(executeSetup({enabledApps:['codex','antigravity']}),/simulated bootstrap failure/);
      assert.equal(services.size,2);
      assert.equal(fs.readFileSync(marker,'utf8'),'old-runtime');
      assert.equal(fs.readFileSync(config,'utf8'),configBefore);
      assert.equal(fs.readFileSync(agyConfig,'utf8'),agyBefore);
      assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),before);
      await assert.rejects(executeSetup({enabledApps:['codex','antigravity'],verify:async()=>{throw new Error('simulated post-install health failure')}}),/post-install health failure/);
      assert.equal(services.size,2);
      assert.equal(fs.readFileSync(marker,'utf8'),'old-runtime');
      assert.equal(fs.readFileSync(config,'utf8'),configBefore);
      assert.equal(fs.readFileSync(agyConfig,'utf8'),agyBefore);
      assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),before);
      await uninstallAll();
      assert.equal(services.size,0);
      assert.equal(require('./src/cli/setup-orchestrator.cjs').readConfig().installed,false);
      assert.ok(!fs.existsSync(path.join(DATA_DIR,'runtime')));
      assert.deepEqual(ledgers.map(f=>fs.readFileSync(f,'utf8')),before);
      assert.deepEqual(JSON.parse(fs.readFileSync(agyConfig)).mcpServers,{unrelated:{command:'keep'}});
      assert.ok(!fs.readFileSync(config,'utf8').includes('[mcp_servers.session_status]'));
      fs.unlinkSync(config);
      await assert.rejects(executeSetup({enabledApps:['codex']}),/登录/);
      assert.equal(services.size,0);
      assert.ok(!fs.existsSync(path.join(DATA_DIR,'runtime')));
      await executeSetup({enabledApps:['antigravity']});
      assert.equal(services.size,1);
      assert.ok(!fs.existsSync(path.join(DATA_DIR,'bridge')));
      await uninstallAll();
      for(const relative of ['.codex/skills/agent-things/SKILL.md','.gemini/config/skills/agent-things/SKILL.md'])assert.ok(!fs.existsSync(path.join(home,relative)));
    })().catch(error=>{console.error(error);process.exitCode=1});
  `], { cwd: process.env.AGENT_THINGS_INSTALL_ROOT || path.resolve(__dirname, '..'), env: { ...process.env, HOME: home, DEVELOPER_DIR: '/agent-things-no-developer-tools' }, stdio: 'pipe', timeout: 60000 });
});
