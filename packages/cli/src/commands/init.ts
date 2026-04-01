import { createInterface } from 'node:readline'
import { readConfig, writeConfig, generateToken, DEFAULT_AGENTS_HOME } from '@codecrab/server/auth'
import { startServer } from '@codecrab/server'
import { openBrowser, waitForServer, log } from '../util.js'

async function promptAgentsHome(): Promise<string> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write(
      `\x1b[36m[codecrab]\x1b[0m Agents will be stored at: \x1b[33m${DEFAULT_AGENTS_HOME}\x1b[0m\n` +
      `           Press Enter to use this location, or type a custom path: `
    )
    rl.once('line', (answer) => {
      rl.close()
      const trimmed = answer.trim()
      resolve(trimmed || DEFAULT_AGENTS_HOME)
    })
  })
}

export async function init() {
  log.info('Initializing CodeCrab...')

  // Check if already initialized
  const existingConfig = await readConfig()
  if (existingConfig.token) {
    log.warn('Already initialized. Generating a new token...')
  }

  // Generate and save token
  const token = generateToken()
  let config = { ...existingConfig, token }

  // Set up agents home directory if not already configured
  if (!existingConfig.agentsHome) {
    const agentsHome = await promptAgentsHome()
    config = { ...config, agentsHome }
    log.success(`Agents home set to: ${agentsHome}`)
  } else {
    log.info(`Agents home: ${existingConfig.agentsHome}`)
  }

  await writeConfig(config)
  log.success(`Token generated: ${token.slice(0, 8)}...${token.slice(-8)}`)

  // Start server
  log.info('Starting server...')
  const { port } = await startServer()

  // Wait for server to be ready
  await waitForServer(port)
  log.success(`Server running at http://localhost:${port}`)

  // Open browser with token for auto-login → setup page
  const url = `http://localhost:${port}/setup?token=${token}`
  log.info('Opening browser for setup...')
  await openBrowser(url)
  log.success('Browser opened. Complete model configuration in the web UI.')
  log.info('Press Ctrl+C to stop the server.')
}
