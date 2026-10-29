import { chromium } from 'playwright'

const base = 'http://localhost:5199'
const out = '/tmp/k8q-v3'
import { mkdirSync } from 'fs'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()

async function shoot(route, name, theme, actions) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (theme === 'dark') await ctx.addInitScript(() => localStorage.setItem('k8q-theme', 'dark'))
  const page = await ctx.newPage()
  await page.goto(`${base}/#/${route}`)
  await page.waitForTimeout(2500)
  if (actions) await actions(page)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
  await ctx.close()
}

await shoot('events', 'events-light', 'light')
await shoot('events', 'events-dark', 'dark')

await shoot('workloads', 'workload-logs-light', 'light', async p => {
  await p.locator('table.data tbody tr').first().click()
  await p.waitForTimeout(700)
  await p.locator('.drawer .tab', { hasText: '日志' }).click()
  await p.waitForTimeout(3000)
})
await shoot('workloads', 'workload-logs-dark', 'dark', async p => {
  await p.locator('table.data tbody tr').first().click()
  await p.waitForTimeout(700)
  await p.locator('.drawer .tab', { hasText: '日志' }).click()
  await p.waitForTimeout(3000)
})

await shoot('workloads', 'workload-yaml-edit-light', 'light', async p => {
  await p.locator('table.data tbody tr').first().click()
  await p.waitForTimeout(700)
  await p.locator('.drawer .tab', { hasText: 'YAML' }).click()
  await p.waitForTimeout(400)
  await p.locator('.seg-btn', { hasText: '编辑' }).click()
  await p.waitForTimeout(300)
  // 修改 replicas 数字,制造 diff
  const ta = p.locator('.yaml-editor')
  const txt = await ta.inputValue()
  await ta.fill(txt.replace(/replicas: \d+/, 'replicas: 9'))
  await p.waitForTimeout(300)
})
await shoot('workloads', 'workload-yaml-diff-dark', 'dark', async p => {
  await p.locator('table.data tbody tr').first().click()
  await p.waitForTimeout(700)
  await p.locator('.drawer .tab', { hasText: 'YAML' }).click()
  await p.waitForTimeout(400)
  await p.locator('.seg-btn', { hasText: '编辑' }).click()
  await p.waitForTimeout(300)
  const ta = p.locator('.yaml-editor')
  const txt = await ta.inputValue()
  await ta.fill(txt.replace(/replicas: \d+/, 'replicas: 9').replace(/cpu: 250m/, 'cpu: 500m'))
  await p.locator('.seg-btn', { hasText: 'Diff' }).click()
  await p.waitForTimeout(500)
})

await browser.close()
console.log('done')
