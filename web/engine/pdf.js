// PDF floor plans, rendered in the browser with the vendored pdf.js (Apache-2.0). Nothing is uploaded to a
// third party: the chosen page becomes an image like any other plan.
const PT_M = 0.0254 / 72; // one PDF point in metres

export const isPdf = (file) => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

/**
 * Render one page of a PDF file to a canvas. Returns { canvas, page, pages, m_per_px_1to1 } where
 * m_per_px_1to1 * (scale denominator) gives metres per pixel for a drawing at a known scale (e.g. 1:100).
 * pickPage(pages) may return the page to use (1-based); default 1.
 */
export async function renderPdf(file, { maxSide = 3000, pickPage } = {}) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    let n = 1;
    if (doc.numPages > 1 && pickPage) n = Math.min(doc.numPages, Math.max(1, Math.round((await pickPage(doc.numPages)) || 1)));
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(8, maxSide / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { canvas, page: n, pages: doc.numPages, m_per_px_1to1: PT_M / scale };
  } finally { doc.destroy(); }
}
