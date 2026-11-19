"""Boot one owned iPhone with bounded waits and the newest installed iOS runtime."""
import json
import subprocess
import sys


def simctl(*args, timeout=180):
    print('simctl ' + ' '.join(args), flush=True)
    return subprocess.run(['xcrun', 'simctl', *args], check=True,
                          capture_output=True, text=True, timeout=timeout).stdout


runtimes = json.loads(simctl('list', 'runtimes', '-j', timeout=300))['runtimes']
ios = [r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-26-')]
runtime = max(ios, key=lambda r: tuple(map(int, r['version'].split('.'))))
device = simctl('create', 'Chandas QA', 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime['identifier']).strip()
print(f'Owned iPhone {device}; iOS {runtime["version"]}', flush=True)
simctl('boot', device, timeout=180)
simctl('bootstatus', device, '-b', timeout=300)
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    output.write(device)
