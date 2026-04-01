import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { readConfig, writeConfig, DEFAULT_AGENTS_HOME } from '@codecrab/server/auth'
import { log } from '../util.js'

export async function agentsHome(args: string[]) {
  const subcommand = args[0]

  if (!subcommand || subcommand === 'show') {
    return await showAgentsHome()
  }

  if (subcommand === 'set') {
    const newPath = args[1]
    if (!newPath) {
      log.error('Usage: codecrab agents-home set <path> [--migrate]')
      process.exit(1)
    }
    const migrate = args.includes('--migrate')
    return await setAgentsHome(newPath, migrate)
  }

  log.error(`Unknown subcommand: ${subcommand}`)
  log.info('Usage:')
  log.info('  codecrab agents-home              Show current agents home')
  log.info('  codecrab agents-home set <path>   Change agents home (no migration)')
  log.info('  codecrab agents-home set <path> --migrate   Change and migrate existing agents')
  process.exit(1)
}

async function showAgentsHome() {
  const config = await readConfig()
  const current = config.agentsHome || DEFAULT_AGENTS_HOME
  const isDefault = !config.agentsHome
  log.info(`Agents home: ${current}${isDefault ? ' (default)' : ''}`)
}

async function setAgentsHome(newPath: string, migrate: boolean) {
  const config = await readConfig()
  const oldPath = config.agentsHome || DEFAULT_AGENTS_HOME

  if (oldPath === newPath) {
    log.warn('New path is the same as the current path. Nothing to do.')
    return
  }

  if (migrate) {
    log.info(`Migrating agents from: ${oldPath}`)
    log.info(`                   to: ${newPath}`)
    await migrateAgents(oldPath, newPath)
    log.success('Migration complete.')
  }

  await writeConfig({ ...config, agentsHome: newPath })
  log.success(`Agents home updated to: ${newPath}`)

  if (!migrate) {
    log.info('Note: existing agents were not moved. Use --migrate to also move agent directories.')
  }
}

async function migrateAgents(oldPath: string, newPath: string) {
  let entries: string[]
  try {
    entries = await readdir(oldPath)
  } catch {
    // Old directory doesn't exist — nothing to migrate
    log.warn(`Source directory not found: ${oldPath}. Nothing to migrate.`)
    return
  }

  await mkdir(newPath, { recursive: true })

  for (const entry of entries) {
    const src = join(oldPath, entry)
    const dest = join(newPath, entry)
    log.info(`  Moving: ${entry}`)
    await cp(src, dest, { recursive: true })
  }
}
