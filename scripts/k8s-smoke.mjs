#!/usr/bin/env node
// 真实集群冒烟测试:验证 node 桥对真实 K8S API server 的 discover/list/log 链路。
// 前置:kubectl 已配置且目标 context 可达;本机启动桥:
//   node qwapp/main-bridge.mjs &
// 运行:
//   node scripts/k8s-smoke.mjs [context]   # 缺省用桥的 defaultContext

import http from 'node:http'

const PORT = Number(process.env.K8Q_BRIDGE_PORT ?? 47831)
const ctxArg = process.argv[2]

function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path, headers: ctxArg ? { 'x-k8q-context': ctxArg } : {} }, res => {
        let d = ''
        res.on('data', c => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d }))
      })
      .on('error', reject)
  })
}

const health = JSON.parse((await get('/health')).body)
console.log('bridge mode =', health.mode, '| contexts =', health.contexts.map(c => c.name).join(', '))
if (health.mode === 'unavailable') {
  console.error('桥降级:', health.error)
  process.exit(1)
}
const context = ctxArg ?? health.defaultContext

for (const p of ['/api/v1/nodes', '/api/v1/namespaces', '/api/v1/pods', '/apis/apps/v1/deployments']) {
  const r = await get(`/k8s${p}`)
  if (r.status !== 200) {
    console.error(`✗ ${p} → HTTP ${r.status}:`, r.body.slice(0, 160))
    process.exit(1)
  }
  const j = JSON.parse(r.body)
  console.log(`✓ ${p} → ${j.items?.length ?? '?'} items`)
}

// 取一个 Running Pod 读日志(若存在)
const pods = JSON.parse((await get('/k8s/api/v1/pods')).body)
const running = pods.items?.find(p => p.status?.phase === 'Running')
if (running) {
  const { metadata } = running
  const r = await get(`/k8s/api/v1/namespaces/${metadata.namespace}/pods/${metadata.name}/log`)
  console.log(`✓ log ${metadata.namespace}/${metadata.name} → HTTP ${r.status}, ${r.body.split('\n').length} 行`)
} else {
  console.log('ℹ 无 Running Pod,跳过日志检查')
}

console.log(`\n冒烟通过:桥 + ${context} 链路可用。在千问办公顶栏选择「集群 · ${context}」即可接入。`)
