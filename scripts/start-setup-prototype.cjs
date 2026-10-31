const { spawn } = require('node:child_process');
const expo = require.resolve('expo/bin/cli');

const child = spawn(process.execPath, [expo, 'start', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_SETUP_PROTOTYPE: '1' },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
