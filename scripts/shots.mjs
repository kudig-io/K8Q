import { chromium } from 'playwright'

const base = 'http://localhost:5199'
const out = '/tmp/k8q-shots'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const routes = [
  ['dashboard', '/dashboard'],
  ['workloads', '/explorer?group=workloads&kind=Deployment'],
  ['pods', '/explorer?gvk=%2Fv1%2FPod'],
  ['services', '/explorer?gvk=%2Fv1%2FService'],
  ['nodes', '/explorer?gvk=%2Fv1%2FNode'],
  ['events', '/events'],
  ['assistant', '/assistant'],
  ['releases', '/releases'],
]
for (const [name, path] of routes) {
  await page.goto(`${base}/#${path}`)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
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
