import { chromium } from 'playwright'

const base = 'http://localhost:5199'
const out = '/tmp/k8q-v2'
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

await shoot('dashboard', 'dashboard-light', 'light')
await shoot('dashboard', 'dashboard-dark', 'dark')
await shoot('workloads', 'workloads-light', 'light')
await shoot('workloads', 'workload-yaml-dark', 'dark', async p => {
  await p.locator('table.data tbody tr').first().click()
  await p.waitForTimeout(700)
  await p.locator('.drawer .tab', { hasText: 'YAML' }).click()
  await p.waitForTimeout(500)
})
await shoot('assistant', 'assistant-light', 'light', async p => {
  await p.locator('.quick-btn').first().click()
  await p.waitForTimeout(9000)
})
await shoot('releases', 'releases-light', 'light')
await shoot('releases', 'releases-dark', 'dark', async p => {
  await p.locator('.release-card').nth(1).click()
  await p.waitForTimeout(500)
})

await browser.close()
console.log('done')
