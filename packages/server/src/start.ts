import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.PORT || '4200', 10)

/**
 * Spawn the server as a background subprocess and return immediately.
 * The server runs as a detached process — use waitForServer() in the CLI
 * to poll until it responds on the health endpoint.
 */
export async function startServer(): Promise<{ port: number }> {
  // Detect runtime environment by checking the file extension of this module.
  // When run via tsx (dev), import.meta.url ends in .ts; compiled (prod) ends in .js.
  const isDev = import.meta.url.endsWith('.ts')

  let cmd: string
  const entry = isDev
    ? resolve(__dirname, 'index.ts')
    : resolve(__dirname, 'index.js')

  if (isDev) {
    // In monorepo dev mode, tsx lives in the workspace root node_modules
    cmd = resolve(__dirname, '../../../../node_modules/.bin/tsx')
  } else {
    cmd = process.execPath
  }

  const child = spawn(cmd, [entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })

  if (child.pid === undefined) {
    throw new Error('Failed to spawn server process')
  }

  child.unref()

  return { port: PORT }
}
