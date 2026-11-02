// K8Q node 桥:qwapp runtime.main 入口(executionMode=node)。
// 在 127.0.0.1 上起一个受限 REST 代理,读取 kubeconfig 并携带客户端证书/token 访问
// K8S API server;视图(dist/ui)通过 fetch(http://127.0.0.1:<port>) 消费。
//
// 端口发现:扫描 47831-47845;/health 返回 {app:'io.kudig.k8q'} 供视图自校验。
// 开发模式:环境变量 K8Q_API_SERVER 指向任意 HTTP 端点(如 scripts/mock-apiserver.mjs),
// 跳过 kubeconfig;K8Q_BRIDGE_PORT 可固定端口。

import http from 'node:http'
import https from 'node:https'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_ID = 'io.kudig.k8q'
const PORT_RANGE = [47831, 47845]
const log = (...a) => console.log('[k8q-bridge]', ...a)

// QwenWork App Main 契约:worker 导入本模块后要求 default 导出
// { kind:'qwenwork-app-main', contract, commands, tools, ... }。
// 契约以打包内 dist/tool-catalog.json 为准;开发模式回退到内置同构定义。
const CONTRACT_FALLBACK = {
  kind: 'qwenwork-app-contract',
  id: 'io.kudig.k8q.contract',
  version: '1.0.0',
  commands: {},
  events: {},
}

function loadContract() {
  for (const rel of ['./tool-catalog.json', './dist/tool-catalog.json']) {
    try {
      const catalog = JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'))
      if (catalog?.contract?.kind === 'qwenwork-app-contract') return catalog.contract
    } catch {
      /* 回退到内置契约 */
    }
  }
  return CONTRACT_FALLBACK
}

// ── kubeconfig 读取 ────────────────────────────────────────
function loadKubeconfig() {
  const envServer = process.env.K8Q_API_SERVER
  if (envServer) return { mode: 'env', server: envServer, contexts: [{ name: 'dev', cluster: 'dev', server: envServer }], defaultContext: 'dev' }
  const kubectl = process.env.K8Q_KUBECTL ?? 'kubectl'
  const r = spawnSync(kubectl, ['config', 'view', '--raw', '-o', 'json'], { encoding: 'utf8', timeout: 8000 })
  if (r.error || r.status !== 0) {
    const reason = r.error ? r.error.message : (r.stderr ?? '').trim().slice(0, 200)
    throw new Error(`无法读取 kubeconfig(需要 PATH 中存在 kubectl):${reason}`)
  }
  const cfg = JSON.parse(r.stdout)
  const clusterByName = new Map((cfg.clusters ?? []).map(c => [c.name, c.cluster ?? {}]))
  const userByName = new Map((cfg.users ?? []).map(u => [u.name, u.user ?? {}]))
  const contexts = (cfg.contexts ?? [])
    .map(c => {
      const cluster = clusterByName.get(c.context?.cluster)
      if (!cluster?.server) return undefined
      return { name: c.name, cluster: c.context?.cluster, server: cluster.server, user: c.context?.user, namespace: c.context?.namespace }
    })
    .filter(Boolean)
  if (contexts.length === 0) throw new Error('kubeconfig 中没有可用的 context(server 缺失)')
  return { mode: 'kubeconfig', cfg, clusterByName, userByName, contexts, defaultContext: cfg['current-context'] ?? contexts[0].name }
}

function agentFor(kube, contextName) {
  if (kube.mode === 'env') return undefined
  const ctx = kube.contexts.find(c => c.name === contextName) ?? kube.contexts[0]
  const cluster = kube.clusterByName.get(ctx.cluster) ?? {}
  const user = kube.userByName.get(ctx.user) ?? {}
  const opts = {}
  if (user['client-certificate-data']) opts.cert = Buffer.from(user['client-certificate-data'], 'base64')
  if (user['client-key-data']) opts.key = Buffer.from(user['client-key-data'], 'base64')
  if (cluster['certificate-authority-data']) opts.ca = Buffer.from(cluster['certificate-authority-data'], 'base64')
  else if (cluster['certificate-authority']) opts.ca = fs.readFileSync(cluster['certificate-authority'])
  if (cluster['insecure-skip-tls-verify'] || (!opts.ca && !cluster['certificate-authority'])) opts.rejectUnauthorized = false
  return Object.keys(opts).length ? new https.Agent(opts) : undefined
}

function authHeadersFor(kube, contextName) {
  if (kube.mode === 'env') return {}
  const ctx = kube.contexts.find(c => c.name === contextName) ?? kube.contexts[0]
  const user = kube.userByName.get(ctx.user) ?? {}
  const h = {}
  if (user.token) h.Authorization = `Bearer ${user.token}`
  else if (user.username) h.Authorization = `Basic ${Buffer.from(`${user.username}:${user.password ?? ''}`).toString('base64')}`
  return h
}

// ── 请求转发 ───────────────────────────────────────────────
function proxyK8s(kube, contextName, req, res, apiPath) {
  const ctx = kube.contexts.find(c => c.name === contextName) ?? kube.contexts[0]
  const server = kube.mode === 'env' ? kube.server : (kube.clusterByName.get(ctx.cluster)?.server ?? ctx.server)
  const base = new URL(server)
  const isHttps = base.protocol === 'https:'
  const outPath = base.pathname.replace(/\/+$/, '') + apiPath
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const mod = isHttps ? https : http
    const headers = {
      host: base.host,
      accept: req.headers.accept ?? 'application/json',
      ...authHeadersFor(kube, contextName),
    }
    if (body.length) {
      headers['content-type'] = req.headers['content-type'] ?? (req.method === 'PATCH' ? 'application/merge-patch+json' : 'application/json')
      headers['content-length'] = body.length
    }
    const upstream = mod.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || (isHttps ? 443 : 80),
        path: outPath,
        method: req.method === 'DELETE' ? 'DELETE' : req.method,
        headers,
        ...(isHttps ? { agent: agentFor(kube, contextName) } : {}),
        timeout: 30_000,
      },
      up => {
        const ctype = up.headers['content-type'] ?? 'application/json'
        res.writeHead(up.statusCode ?? 502, {
          'content-type': ctype,
          'access-control-allow-origin': '*',
          'x-k8q-upstream-status': String(up.statusCode),
        })
        up.pipe(res)
      },
    )
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')))
    upstream.on('error', err => {
      res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify({ kind: 'Status', status: 'Failure', code: 502, message: `K8S API 不可达:${err.message}`, reason: 'K8QBridgeUpstreamError' }))
    })
    if (body.length) upstream.write(body)
    upstream.end()
  })
}

// ── HTTP 服务 ──────────────────────────────────────────────
let bridgeServer = null
let bridgeStarted = false

function startBridge(kube) {
  const fixedPort = process.env.K8Q_BRIDGE_PORT ? Number(process.env.K8Q_BRIDGE_PORT) : undefined
  const ports = fixedPort ? [fixedPort] : range(PORT_RANGE[0], PORT_RANGE[1])

  const tryListen = i => {
    if (i >= ports.length) {
      log(`桥接端口 ${PORT_RANGE[0]}-${PORT_RANGE[1]} 全部被占用,本次跳过启动`)
      return
    }
    const port = ports[i]
    const server = http.createServer((req, res) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'Content-Type,X-K8Q-Context' }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }
      const u = new URL(req.url, 'http://127.0.0.1')
      const apiPath = u.pathname.replace(/^\/k8s/, '')
      const context = req.headers['x-k8q-context'] ?? u.searchParams.get('context') ?? kube.defaultContext

      if (u.pathname === '/health') {
        res.writeHead(200, { ...cors, 'content-type': 'application/json' })
        res.end(JSON.stringify({ app: APP_ID, ok: true, bridge: true, mode: kube.mode, defaultContext: kube.defaultContext, contexts: kube.contexts.map(c => ({ name: c.name, cluster: c.cluster, server: c.server, namespace: c.namespace })) }))
        return
      }
      if (u.pathname === '/' || u.pathname === '') {
        res.writeHead(200, { ...cors, 'content-type': 'application/json' })
        res.end(JSON.stringify({ app: APP_ID }))
        return
      }
      if (u.pathname.startsWith('/k8s/') || u.pathname === '/k8s') {
        proxyK8s(kube, context, req, res, apiPath === '' ? '/' : apiPath + u.search)
        return
      }
      res.writeHead(404, { ...cors, 'content-type': 'application/json' })
      res.end(JSON.stringify({ kind: 'Status', status: 'Failure', code: 404, message: 'bridge: unknown path' }))
    })

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') tryListen(i + 1)
      else log('桥接启动失败:', err.message)
    })
    server.listen(port, '127.0.0.1', () => {
      bridgeServer = server
      log(`桥接已启动 http://127.0.0.1:${port} (mode=${kube.mode}, contexts=${kube.contexts.length})`)
      announce(port, kube)
    })
  }
  tryListen(0)
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out }

function announce(port, kube) {
  const info = { app: APP_ID, port, pid: process.pid, startedAt: new Date().toISOString(), mode: kube.mode, contexts: kube.contexts.map(c => c.name) }
  try {
    fs.writeFileSync(path.join(os.homedir(), '.k8q-bridge.json'), JSON.stringify(info, null, 2))
  } catch (e) {
    log('端口信息写盘失败(不影响运行):', e.message)
  }
  // runtime 注入的 SDK 全局(若存在)则写入应用 storage,作为视图端快路径
  const qw = globalThis.qw
  if (qw && typeof qw.storage?.set === 'function') {
    try {
      qw.storage.set('bridge.port', String(port))
      log('已写入 qw.storage bridge.port =', port)
    } catch (e) {
      log('qw.storage 不可用:', e.message)
    }
  } else {
    log('qw SDK 全局不可用,仅端口段扫描 + ~/.k8q-bridge.json 可供发现')
  }
}

function unavailableKube(error) {
  return {
    mode: 'unavailable',
    error,
    contexts: [],
    defaultContext: undefined,
    clusterByName: new Map(),
    userByName: new Map(),
  }
}

function ensureBridge() {
  if (bridgeStarted) return
  bridgeStarted = true
  try {
    startBridge(loadKubeconfig())
  } catch (e) {
    // 降级:仍启动一个仅 /health 的桥,视图可探测到 kubectl/kubeconfig 问题并给出准确提示
    log('启动受限:', e.message)
    startBridge(unavailableKube(e.message))
  }
}

function stopBridge() {
  if (!bridgeServer) return
  const server = bridgeServer
  bridgeServer = null
  bridgeStarted = false
  server.close()
  server.closeAllConnections?.()
  log('桥接已停止')
}

// QwenWork App Main 定义:worker bootstrap 会校验该默认导出;
// 桥在 worker 就绪后启动,避免 kubectl 读取阻塞启动握手。
const appMain = {
  kind: 'qwenwork-app-main',
  contract: loadContract(),
  commands: {},
  tools: [],
  onActivate() {
    ensureBridge()
  },
  onDeactivate() {
    stopBridge()
  },
}

export default appMain

setImmediate(ensureBridge)
