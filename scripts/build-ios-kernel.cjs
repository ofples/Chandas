const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const destination = path.resolve(__dirname, '../modules/chandas-timer-service/ios/Resources/ChandasKernel.js')
const output = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/lib/ios-timer-kernel.ts')],
  bundle: true, platform: 'neutral', format: 'iife', globalName: 'ChandasKernel',
  target: 'es2020', write: false, legalComments: 'none', charset: 'ascii',
}).outputFiles[0].text
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) {
    console.error('The native iOS kernel is stale. Run npm run ios:kernel.'); process.exitCode = 1
  }
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, output)
  console.log('Built the canonical iOS timer kernel.')
}
