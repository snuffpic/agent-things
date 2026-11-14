'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=process.env.AGENT_THINGS_AUDIT_ROOT||path.resolve(__dirname,'..');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'command-matrix-'));
const env={...process.env,HOME:home};
const cli=path.join(root,'bin/codex-session-status.cjs');
const results=[];
function run(args,expected=0,bin=cli){
 const r=spawnSync(process.execPath,[bin,...args],{encoding:'utf8',input:'',env,timeout:10000});
 assert.equal(r.error,undefined);assert.equal(r.status,expected,`${args}: ${r.stderr}`);
 results.push({args,bin:path.basename(bin),exitCode:r.status,stdout:r.stdout.slice(0,160),stderr:r.stderr.slice(0,200)});
 return r;
}
try{
 for(const args of [['help'],['--help'],['-h'],['setup','--help'],['run','--help'],['mcp','--help'],['status','--help']])run(args);
 for(const args of [['status','--all'],['--help','-y'],['setup','--unknown'],['run','--port','invalid'],['run','--data-dir'],['unknown'],[]])run(args,1);
 const yes=run(['--yes'],1);assert.ok(!yes.stderr.includes('未知命令'));
 const codexHome=path.join(home,'.codex');fs.mkdirSync(codexHome,{recursive:true});const config=path.join(codexHome,'config.toml');
 fs.writeFileSync(config,'[mcp_servers.keep]\ncommand="keep"\n');
 const data=path.join(home,'Library/Application Support/CodexSessionStatus');fs.mkdirSync(path.join(data,'runtime/bin'),{recursive:true});
 fs.writeFileSync(path.join(data,'runtime/bin/codex-session-status.cjs'),'fixture');
 run(['install-mcp']);assert.ok(fs.readFileSync(config,'utf8').includes(path.join(data,'runtime/bin/codex-session-status.cjs')));
 run(['disable-mcp']);assert.ok(fs.readFileSync(config,'utf8').includes('[mcp_servers.keep]'));
 assert.ok(!fs.readFileSync(config,'utf8').includes('[mcp_servers.session_status]'));
 const rendererDir=path.join(home,'renderer-test');
 const firstResource=path.join(rendererDir,'runtime/src/session-status.js');fs.mkdirSync(path.dirname(firstResource),{recursive:true});fs.writeFileSync(firstResource,'preserve');
 run(['update-renderer','--data-dir',rendererDir],1);assert.equal(fs.readFileSync(firstResource,'utf8'),'preserve');
 for(const name of ['session-status.js','harnesses/codex/codex-harness.js']){
  const file=path.join(rendererDir,'runtime/src',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'old fixture');
 }
 run(['update-renderer','--data-dir',rendererDir]);
 for(const name of ['session-status.js','harnesses/codex/codex-harness.js'])assert.equal(fs.readFileSync(path.join(rendererDir,'runtime/src',name),'utf8'),fs.readFileSync(path.join(root,'src',name),'utf8'));
 run(['status','--port','39998','--data-dir',path.join(home,'status-test')]);
 const agy=path.join(root,'bin/antigravity-session-status.cjs');
 for(const args of [['--help'],['--daemon','--help'],['--no-ui','-h']])run(args,0,agy);
 run(['--unknown'],1,agy);
 const output=path.resolve(__dirname,'../outputs/cli-command-results.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2));
 console.log(`${results.length} real subprocess command checks passed`);
}finally{fs.rmSync(home,{recursive:true,force:true})}
