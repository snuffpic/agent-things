'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function invoke(args) {
 const calls=[],signals={};
 const fakeProcess={argv:['node','agent-things',...args],env:{},pid:123,ppid:1,once:(name,handler)=>{signals[name]=handler;},stderr:{write:()=>{}}};
 const fakeFs={existsSync:()=>false,mkdirSync:()=>{},writeFileSync:()=>{},readFileSync:()=>JSON.stringify({app:'/Applications/ChatGPT.app',allowClientRestart:false})};
 const mocks={
  'node:fs':fakeFs,
  '../src/state-file-lock.cjs':{tryAcquirePidLock:()=>true},
  '../src/cli/arguments.cjs':require('../src/cli/arguments.cjs'),
  '../src/manual-status-store.cjs':{ManualStatusStore:class{recoverPending(){} snapshot(){return {revision:0,records:{}}}}},
  '../src/manual-status-agent.cjs':{ManualStatusAgent:class{constructor(){this.sessions=new Map();this.log=()=>{};}async startControl(){calls.push('control')}async scan(){calls.push('scan')}async stop(){calls.push('stop')}},attachmentStatus:async()=>({})},
  '../src/cdp.cjs':{CDP_PORT:39222},
  '../src/manual-status-startup.cjs':{installAutostart:async directory=>{calls.push(['install-autostart',directory]);return{}},disableAutostart:async()=>calls.push('disable-autostart'),startupStatus:()=>({})},
  '../src/codex-mcp-config.cjs':{},
  '../src/cli/interactive-cli.cjs':{runInteractiveCli:async options=>calls.push(['setup',options])},
  '../src/startup/watch.cjs':{startWatcher:()=>{calls.push('watch');return{stop:()=>calls.push('watch-stop'),exited:new Promise(()=>{})}}},
 };
 const file=path.resolve(__dirname,'../bin/codex-session-status.cjs'),mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports,__dirname,__filename,process,console){'+fs.readFileSync(file,'utf8').replace(/^#!.*\n/,'')+'\n})',{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{}})(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),mod,mod.exports,path.dirname(file),file,fakeProcess,{log:()=>{}});
 await mod.exports.main();
 if(signals.SIGTERM)await signals.SIGTERM();
 return calls;
}
test('advanced startup commands dispatch without invoking the setup wizard',async()=>{
 assert.deepEqual(await invoke(['disable-autostart']),['disable-autostart']);
 assert.deepEqual(await invoke(['install-autostart','--data-dir','/fixture']),[['install-autostart','/fixture']]);
 assert.deepEqual(await invoke(['run','--port','39998','--watch-startup']),['control','watch','scan','watch-stop','stop']);
});
test('help and setup aliases dispatch only their own action',async()=>{
 assert.deepEqual(await invoke(['run','--help']),[]);
 const result=await invoke(['--yes']);assert.equal(result.length,1);assert.equal(result[0][0],'setup');assert.equal(result[0][1].yes,true);
});
