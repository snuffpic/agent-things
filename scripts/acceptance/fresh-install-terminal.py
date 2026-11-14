import json
import os
import pty
import select
import subprocess
import sys
import time

scenario, transcript = sys.argv[1:]
master, slave = pty.openpty()
process = subprocess.Popen(['npx', 'agent-things'], cwd=os.environ['AGENT_THINGS_ACCEPTANCE_HOME'], stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy(), close_fds=True)
os.close(slave)
data = b''
stage = 'npm'
npm_confirmed = False
deadline = time.monotonic() + 50
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            data += chunk
            if b'Ok to proceed?' in data and not npm_confirmed:
                os.write(master, b'y\r')
                npm_confirmed = True
            if stage == 'npm' and b'Select Language' in data:
                english = b'\r' if b'Select Language /' in data else b'j\r'
                os.write(master, b'\x1b' if scenario == 'cancel' else b'\x03' if scenario == 'ctrl-c' else english)
                stage = 'apps'
            elif stage == 'apps' and b'Select target applications' in data:
                keys = {'codex': b'j \r', 'antigravity': b' \r', 'none': b'a\r', 'claude': b' j \r'}
                os.write(master, keys.get(scenario, b'\r'))
                stage = 'install'
            elif stage == 'npm' and b'Agent Things (Enabled:' in data:
                os.write(master, (b'jjjj' + b'\r') if scenario == 'uninstall' else (b'jjjjj' + b'\r'))
                stage = 'confirm' if scenario == 'uninstall' else 'management'
            elif stage == 'confirm' and b'Uninstall services and integrations' in data:
                os.write(master, b'\t\r')
                stage = 'uninstall'
        if process.poll() is not None:
            break
    if process.poll() is None:
        process.terminate()
        raise RuntimeError('Terminal timed out: ' + data[-1000:].decode(errors='replace'))
    code = process.wait(timeout=5)
finally:
    if process.poll() is None:
        process.kill()
        process.wait(timeout=5)
    os.close(master)
    with open(transcript, 'wb') as target:
        target.write(data)
print(json.dumps({'exitCode': code, 'cursorRestored': b'\x1b[?25h' in data, 'stage': stage, 'command': 'npx agent-things'}))
