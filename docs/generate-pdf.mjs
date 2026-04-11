#!/usr/bin/env node
/**
 * PhotonBoard — PDF Manual Generator
 *
 * Usage: node docs/generate-pdf.mjs
 * Output: docs/PhotonBoard-Manuel-Utilisateur.pdf
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import puppeteer from 'puppeteer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const INPUT = join(__dirname, 'manual.html')
const OUTPUT = join(__dirname, 'PhotonBoard-Manuel-Utilisateur.pdf')

async function generate() {
  console.log('[PDF] Launching browser...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()

  console.log(`[PDF] Loading ${INPUT}...`)
  await page.goto(`file://${INPUT}`, { waitUntil: 'networkidle0', timeout: 30000 })

  // Wait for fonts / rendering
  await page.evaluate(() => document.fonts.ready)

  console.log(`[PDF] Generating PDF...`)
  await page.pdf({
    path: OUTPUT,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `
      <div style="width:100%; text-align:center; font-size:8pt; color:#999; padding:0 40px;">
        <span>PhotonBoard — Mode d'emploi</span>
        <span style="float:right;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    `,
    margin: {
      top: '20mm',
      bottom: '22mm',
      left: '18mm',
      right: '18mm'
    },
    preferCSSPageSize: false
  })

  await browser.close()
  console.log(`[PDF] Done! → ${OUTPUT}`)
}

generate().catch(err => {
  console.error('[PDF] Error:', err.message)
  process.exit(1)
})
