import { chromium } from 'playwright'

const base = 'http://localhost:5199'
const out = '/tmp/k8q-shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const routes = ['dashboard', 'workloads', 'assistant', 'releases']
for (const r of routes) {
  await page.goto(`${base}/#/${r}`)
  await page.waitForTimeout(3200)
  await page.screenshot({ path: `${out}/${r}.png` })
  console.log('shot', r)
}

// workload drawer + yaml tab
await page.goto(`${base}/#/workloads`)
await page.waitForTimeout(2500)
await page.locator('table.data tbody tr').first().click()
await page.waitForTimeout(800)
await page.locator('.drawer .tab', { hasText: 'YAML' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/workload-yaml.png` })
console.log('shot workload-yaml')

// assistant conversation
await page.goto(`${base}/#/assistant`)
await page.waitForTimeout(2000)
await page.locator('.quick-btn').first().click()
await page.waitForTimeout(9000)
await page.screenshot({ path: `${out}/assistant-chat.png` })
console.log('shot assistant-chat')

// releases: trigger rollback flow visual
await page.goto(`${base}/#/releases`)
await page.waitForTimeout(2500)
await page.locator('.release-card').nth(1).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/releases-detail.png` })
console.log('shot releases-detail')

await browser.close()
console.log('done')
