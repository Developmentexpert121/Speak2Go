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
      // The client asked for page numbers (24 Aug 2026) so a teacher and a
      // student can refer to the same place over the phone.
      //
      // Chrome only paints header/footer templates in its own margin box, and
      // it ignores the page's stylesheet in there — hence the inline styles and
      // the enlarged bottom margin, which has to leave room for the footer or
      // the numbers land on top of the content.
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;font-family:Helvetica,Arial,sans-serif;' +
        'color:#667582;text-align:center;padding:0 20px;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "20px", bottom: "42px", left: "20px", right: "20px" },
    });
  } finally {
    await browser.close();
  }
  return outputPath;
}

module.exports = { renderReportPdf };
