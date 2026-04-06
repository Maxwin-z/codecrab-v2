const path = require('path')

const ROOT = __dirname

module.exports = {
  apps: [
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
    {
      name: 'frpc',
      script: '/opt/homebrew/bin/frpc',
      args: '-c /opt/homebrew/etc/frp/frpc.toml',
      instances: 1,
      autorestart: true,
      watch: false,
      error_file: path.join(ROOT, '.logs/frpc-error.log'),
      out_file: path.join(ROOT, '.logs/frpc-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
