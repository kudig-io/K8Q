import { chromium } from 'playwright'

const base = 'http://localhost:5199/#'
const out = 'docs/screenshots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function theme(mode) {
  await page.evaluate(m => {
    document.documentElement.dataset.theme = m
    localStorage.setItem('k8q-theme', m)
  }, mode)
  await page.waitForTimeout(250)
}

async function go(path, wait = 1400) {
  await page.goto(`${base}${path}`)
  await page.waitForTimeout(wait)
}

// light: dashboard / events / workloads / assistant
await go('/dashboard')
await theme('light')
await page.screenshot({ path: `${out}/dashboard-light.png` })
console.log('dashboard-light')

await go('/events', 1600)
await page.screenshot({ path: `${out}/events-light.png` })
console.log('events-light')

await go('/explorer?group=workloads&kind=Deployment')
await page.screenshot({ path: `${out}/workloads-light.png` })
console.log('workloads-light')

await go('/assistant')
await page.screenshot({ path: `${out}/assistant-light.png` })
console.log('assistant-light')

await go('/releases')
await page.screenshot({ path: `${out}/releases-light.png` })
console.log('releases-light')

// search popup
await go('/dashboard', 900)
await page.locator('.search-box input').fill('gateway')
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/search-cmdk.png` })
console.log('search-cmdk')
await page.keyboard.press('Escape')

// logs drawer (light)
await go('/explorer?group=workloads&kind=Deployment')
await page.locator('.table-card tbody tr').first().click()
await page.waitForTimeout(400)
await page.locator('.drawer .tab', { hasText: '日志' }).click()
await page.waitForTimeout(3600)
await page.screenshot({ path: `${out}/workload-logs-light.png` })
console.log('workload-logs-light')

// dark dashboard / events
await theme('dark')
await go('/dashboard', 900)
await page.screenshot({ path: `${out}/dashboard-dark.png` })
console.log('dashboard-dark')

await go('/events', 1400)
await page.screenshot({ path: `${out}/events-dark.png` })
console.log('events-dark')

// dark YAML diff
await go('/explorer?group=workloads&kind=Deployment')
await page.locator('.table-card tbody tr').first().click()
await page.waitForTimeout(400)
await page.locator('.drawer .tab', { hasText: 'YAML' }).click()
await page.waitForTimeout(300)
await page.locator('.drawer .seg-btn', { hasText: '编辑' }).click()
await page.waitForTimeout(200)
const ta = page.locator('.drawer textarea.yaml-editor')
const original = await ta.inputValue()
const changed = /replicas:\s*\d+/.test(original)
  ? original.replace(/replicas:\s*\d+/, 'replicas: 12')
  : `${original}\n# ui capture`
await ta.fill(changed)
await page.waitForTimeout(200)
await page.locator('.drawer .btn', { hasText: '预览 Diff' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/workload-yaml-diff-dark.png` })
console.log('workload-yaml-diff-dark')

// ── 其余抽屉截图:始终从当前 deployments 列表重新打开,避免同 URL goto 不刷新 ──
async function closeDrawer() {
  if (await page.locator('.drawer').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

// dark YAML view
await closeDrawer()
await theme('dark')
await page.locator('.table-card tbody tr').first().click()
await page.waitForTimeout(400)
await page.locator('.drawer .tab', { hasText: 'YAML' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/workload-yaml-dark.png` })
console.log('workload-yaml-dark')

// dark logs
await closeDrawer()
await page.locator('.table-card tbody tr').first().click()
await page.waitForTimeout(400)
await page.locator('.drawer .tab', { hasText: '日志' }).click()
await page.waitForTimeout(3200)
await page.screenshot({ path: `${out}/workload-logs-dark.png` })
console.log('workload-logs-dark')

// light YAML editor
await closeDrawer()
await theme('light')
await page.locator('.table-card tbody tr').first().click()
await page.waitForTimeout(400)
await page.locator('.drawer .tab', { hasText: 'YAML' }).click()
await page.waitForTimeout(300)
await page.locator('.drawer .seg-btn', { hasText: '编辑' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/workload-yaml-edit-light.png` })
console.log('workload-yaml-edit-light')

// apply change -> success banner
const ta2 = page.locator('.drawer textarea.yaml-editor')
const before = await ta2.inputValue()
const after = /replicas:\s*\d+/.test(before)
  ? before.replace(/replicas:\s*\d+/, 'replicas: 12')
  : `${before}\n# applied`
await ta2.fill(after)
await page.waitForTimeout(200)
await page.locator('.drawer .btn', { hasText: '应用变更' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/yaml-applied.png` })
console.log('yaml-applied')

// restore light
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; localStorage.setItem('k8q-theme', 'light') })
await browser.close()
console.log('done')