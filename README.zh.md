# CodeCrab v2

AI 驱动的编程引擎，配备 React 网页端、iOS 原生 App 和 CLI。

## 环境要求

- Node.js 20+
- pnpm 10+
- pm2（`npm install -g pm2`）

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置服务端口（可选，生产环境默认 42001）
#    编辑 packages/server/.env
PORT=42001

# 3. 构建并通过 pm2 启动所有服务
pnpm pm2
```

首次启动时终端会打印一个二维码，用 iOS App 扫码连接，或直接在浏览器打开 `http://localhost:5740`。

## 启动 / 停止 / 状态

```bash
pnpm pm2                             # 构建 + 启动（服务端、前端、frpc）
pm2 stop ecosystem.config.cjs       # 停止所有进程
pm2 delete ecosystem.config.cjs     # 停止并注销所有进程
pm2 list                             # 查看进程状态
pm2 logs                             # 实时查看日志
```

日志输出到 `.logs/` 目录：

| 文件 | 说明 |
|---|---|
| `.logs/server-out.log` | API 服务器标准输出 |
| `.logs/server-error.log` | API 服务器错误输出 |
| `.logs/app-out.log` | 网页端标准输出 |
| `.logs/app-error.log` | 网页端错误输出 |
| `.logs/frpc-out.log` | frpc 隧道输出（已配置时） |

## 端口配置

### API 服务端口

编辑 `packages/server/.env`：

```env
PORT=42001
```

服务监听 `0.0.0.0`，局域网内其他设备可直接访问。

### 网页端口

网页端（`vite preview`）默认运行在 **5740** 端口，配置在 `packages/app/vite.config.ts`。如需修改，更新 `preview.port`：

```ts
preview: {
  port: 5740,   // 在此修改
  ...
}
```

### 连接远端服务器

网页端通过 Vite 代理将 `/api` 和 `/ws` 转发到 API 服务器，代理目标端口由 `VITE_API_PORT` 控制（开发环境默认 `4200`，生产环境通过 `ecosystem.config.cjs` 设为 `42001`）。

如需连接其他主机上的服务器，打开网页端 → Settings，填入服务器地址（如 `http://192.168.1.10:42001`），该地址会保存在浏览器 localStorage 中。

### frpc 隧道（可选）

若 `/opt/homebrew/bin/frpc` 和 `/opt/homebrew/etc/frp/frpc.toml` 同时存在，pm2 会自动启动 frpc；否则静默跳过。

## 开发模式

```bash
pnpm dev           # 服务端 + 前端热更新
pnpm dev:server    # 仅启动服务端（端口 4200）
pnpm dev:app       # 仅启动网页端（端口 5740，代理至 4200）
pnpm dev:relay     # 启动 relay 服务
```

## 包结构

| 包 | 说明 |
|---|---|
| `packages/server` | 核心 API 服务端 |
| `packages/app` | React 网页端 |
| `packages/shared` | 共享协议类型 |
| `packages/cli` | CLI 工具（初始化、Token 管理） |
| `packages/relay` | 远程访问 WSS 代理 |
| `packages/channels` | 插件注册表（Telegram 等） |
| `packages/iOS` | SwiftUI iOS 原生 App |
| `packages/web` | 官网 |
