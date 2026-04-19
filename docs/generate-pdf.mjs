#!/usr/bin/env node
/**
 * PhotonBoard — PDF Generator
 *
 * Usage: node docs/generate-pdf.mjs
 * Outputs:
 *   - docs/PhotonBoard-Manuel-Utilisateur.pdf  (~38 pages, full user manual)
 *   - scripts/PhotonBoard-Guide-Installation.pdf  (2-page quickstart, dark theme)
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import puppeteer from 'puppeteer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const __root = dirname(__dirname)

const JOBS = [
  {
    label: 'User manual',
    input: join(__dirname, 'manual.html'),
    output: join(__dirname, 'PhotonBoard-Manuel-Utilisateur.pdf'),
    pdfOptions: {
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
      margin: { top: '20mm', bottom: '22mm', left: '18mm', right: '18mm' },
      preferCSSPageSize: false
    }
  },
  {
    label: 'Install guide',
    input: join(__dirname, 'install-guide.html'),
    output: join(__root, 'scripts', 'PhotonBoard-Guide-Installation.pdf'),
    pdfOptions: {
      format: 'A4',
      printBackground: true,
      // The install guide handles its own margins via .page padding,
      // so we use full-bleed @page margin: 0 (set in CSS) and no headers.
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      preferCSSPageSize: true
    }
  }
]

async function generateOne(browser, job) {
  const page = await browser.newPage()
  console.log(`[PDF] [${job.label}] loading ${job.input}`)
  await page.goto(`file://${job.input}`, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  console.log(`[PDF] [${job.label}] rendering → ${job.output}`)
  await page.pdf({ path: job.output, ...job.pdfOptions })
  await page.close()
  console.log(`[PDF] [${job.label}] done`)
}

async function main() {
  console.log('[PDF] Launching browser…')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    for (const job of JOBS) {
      await generateOne(browser, job)
    }
  } finally {
    await browser.close()
  }
  console.log('[PDF] All PDFs generated.')
}

main().catch(err => {
  console.error('[PDF] Error:', err.message)
  process.exit(1)
})
