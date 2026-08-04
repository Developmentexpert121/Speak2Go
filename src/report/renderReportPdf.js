const puppeteer = require("puppeteer");

/**
 * Renders report HTML to a PDF file on disk. Kept separate from
 * renderReportHtml.js so the HTML function stays dependency-free and
 * reusable for inline UI rendering (per spec: HTML for inline UI, PDF for
 * download — same content, two outputs).
 */
async function renderReportPdf(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"], // needed in most container/CI environments
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });
  } finally {
    await browser.close();
  }
  return outputPath;
}

module.exports = { renderReportPdf };
