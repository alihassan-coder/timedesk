// Builds, then starts the app in development. Passes extra arguments through, for example:
//   pnpm dev -- --web-url=http://localhost:5173
import { spawn } from 'node:child_process'
import electron from 'electron'

await new Promise((resolve, reject) => {
  const b = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' })
  b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build failed'))))
})

// VS Code based terminals can set ELECTRON_RUN_AS_NODE, which makes Electron behave like plain Node
// and crash on start. The app must never inherit it.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.', ...process.argv.slice(2).filter((a) => a !== '--')], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
