const path = require('path')
const fs = require('fs')

const ROOT = __dirname

const FRPC_BIN = '/opt/homebrew/bin/frpc'
const FRPC_CONFIG = '/opt/homebrew/etc/frp/frpc.toml'

const hasfrpc = fs.existsSync(FRPC_BIN) && fs.existsSync(FRPC_CONFIG)

const apps = [
  {
    name: 'codecrab-app',
    script: path.join(ROOT, 'packages/app/node_modules/vite/bin/vite.js'),
    args: 'preview',
    cwd: path.join(ROOT, 'packages/app'),
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    error_file: path.join(ROOT, '.logs/app-error.log'),
    out_file: path.join(ROOT, '.logs/app-out.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  },
  {
    name: 'codecrab-server',
    script: path.join(ROOT, 'packages/server/dist/index.js'),
    cwd: path.join(ROOT, 'packages/server'),
    env: {
      PORT: '42001',
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    error_file: path.join(ROOT, '.logs/server-error.log'),
    out_file: path.join(ROOT, '.logs/server-out.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  },
]

if (hasfrpc) {
  apps.push({
    name: 'frpc',
    script: FRPC_BIN,
    args: `-c ${FRPC_CONFIG}`,
    instances: 1,
    autorestart: true,
    watch: false,
    error_file: path.join(ROOT, '.logs/frpc-error.log'),
    out_file: path.join(ROOT, '.logs/frpc-out.log'),
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  })
}

module.exports = { apps }
