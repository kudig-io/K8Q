// QwenWork App Runtime(main 入口)契约校验。
// runtime worker 会 import dist/main.mjs 并校验默认导出:
//   kind = qwenwork-app-main
//   contract.kind = qwenwork-app-contract
//   commands 必须与契约 commands 完全一致
//   tools 必须是数组, 生命周期钩子必须是函数
// 该脚本直接导入 qwapp/main-bridge.mjs,不启动 UI、不安装应用。

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const bridgePath = path.join(root, 'qwapp', 'main-bridge.mjs')
const catalogPath = path.join(root, 'qwapp', 'tool-catalog.json')

const errors = []
const assert = (ok, msg) => { if (!ok) errors.push(msg) }

const mod = await import(pathToFileURL(bridgePath).href)
const main = mod.default
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

assert(main && typeof main === 'object', 'main-bridge.mjs 必须默认导出对象')
assert(main?.kind === 'qwenwork-app-main', `默认导出 kind 必须是 qwenwork-app-main(当前 ${main?.kind}）`)

const contract = main?.contract
assert(contract?.kind === 'qwenwork-app-contract', `contract.kind 必须是 qwenwork-app-contract(当前 ${contract?.kind}）`)
assert(typeof contract?.id === 'string' && contract.id.length > 0, 'contract.id 不能为空')
assert(typeof contract?.version === 'string' && contract.version.length > 0, 'contract.version 不能为空')
assert(contract?.commands && typeof contract.commands === 'object' && !Array.isArray(contract.commands), 'contract.commands 必须是对象')
assert(contract?.events && typeof contract.events === 'object' && !Array.isArray(contract.events), 'contract.events 必须是对象')

const contractCommands = Object.keys(contract?.commands ?? {}).sort()
const handlers = Object.keys(main?.commands ?? {}).sort()
assert(
  JSON.stringify(contractCommands) === JSON.stringify(handlers),
  `main.commands 必须与 contract.commands 完全一致(contract=${contractCommands.join(',') || '∅'} / main=${handlers.join(',') || '∅'}）`,
)
for (const [name, handler] of Object.entries(main?.commands ?? {})) {
  assert(typeof handler === 'function', `main.commands.${name} 必须是函数`)
}

assert(Array.isArray(main?.tools), 'main.tools 必须是数组')
for (const hook of ['onActivate', 'onDeactivate', 'onViewAttached', 'onViewDetached', 'onOpen']) {
  assert(main?.[hook] === undefined || typeof main[hook] === 'function', `main.${hook} 必须是函数`)
}

// 打包内 tool-catalog 必须与默认导出的契约一致,否则 worker 会以 App Contract 不匹配失败
assert(catalog?.appId === 'io.kudig.k8q', 'tool-catalog.appId 必须是 io.kudig.k8q')
assert(catalog?.contract?.kind === 'qwenwork-app-contract', 'tool-catalog.contract.kind 必须是 qwenwork-app-contract')
assert(catalog?.contract?.id === contract?.id, 'tool-catalog.contract.id 必须与 main.contract.id 一致')
assert(catalog?.contract?.version === contract?.version, 'tool-catalog.contract.version 必须与 main.contract.version 一致')
const catalogCommands = Object.keys(catalog?.contract?.commands ?? {}).sort()
assert(
  JSON.stringify(catalogCommands) === JSON.stringify(contractCommands),
  `tool-catalog.contract.commands 必须与 main.contract.commands 一致(catalog=${catalogCommands.join(',') || '∅'}）`,
)

if (errors.length) {
  console.error('❌ App Main 契约校验失败:')
  for (const e of errors) console.error('   - ' + e)
  process.exit(1)
}

console.log('✅ App Main 契约校验通过')
console.log(`   kind     = ${main.kind}`)
console.log(`   contract = ${contract.id}@${contract.version}`)
console.log(`   commands = ${handlers.length} 个 · tools = ${main.tools.length} 个`)
console.log(`   hooks    = ${['onActivate', 'onDeactivate'].filter(h => typeof main[h] === 'function').join(', ') || '∅'}`)
process.exit(0)