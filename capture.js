const { chromium } = require('playwright');
const fs = require('fs');
const { getBatchAnalysis, getCategoryFor } = require('./analysis');

// Capture order == display order (cards are numbered sequentially as they're
// found), so this array order controls what plays first on the live view.
//
// IMPORTANT: this script extracts TEXT ONLY from these pages — no
// screenshots, no images, nothing visually reproduced from the source
// sites. Every card displayed on the live is a visual we build ourselves
// (see index.html) from that text. Source names are kept here purely as
// internal metadata for our own dedup/debugging — they are never rendered
// on screen.
const sources = [
    {
        name: 'AlMarsd',
        url: 'https://al-marsd.com/',
        explicitSelector: null,
        sizeWindow: { minWidth: 250, maxWidth: 1000, minHeight: 300, maxHeight: 900 }
    },
    {
        name: 'Akhbaar24',
        url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB',
        explicitSelector: null,
        sizeWindow: { minWidth: 200, maxWidth: 480, minHeight: 220, maxHeight: 620 }
    },
    {
        name: 'SPA',
        url: 'https://www.spa.gov.sa/media?page=1&type=3',
        // Verified from live markup: MuiGrid-item / MuiGrid-grid-md-3 are stable Material-UI
        // framework classes (not the random hashed muirtl-xxxx ones), so this is safe to hardcode.
        explicitSelector: '.MuiGrid-item.MuiGrid-grid-md-3.MuiGrid-grid-lg-3',
        sizeWindow: { minWidth: 180, maxWidth: 420, minHeight: 220, maxHeight: 550 }
    }
];

// Removes floating ads / popups / cookie banners / sticky headers before we
// read anything. These are almost always position:fixed or position:sticky.
async function hideOverlaysAndAds(page) {
    await page.evaluate(() => {
        document.querySelectorAll('body *').forEach(el => {
            const cs = getComputedStyle(el);
            if ((cs.position === 'fixed' || cs.position === 'sticky') &&
                el.offsetWidth > 0 && el.offsetHeight > 0) {
                el.style.setProperty('display', 'none', 'important');
            }
        });
        document.querySelectorAll(
            'iframe[id*="google_ads"], iframe[id*="ad_"], [id*="ad-"], ' +
            '[class*="popup"], [class*="cookie"], [class*="consent"], [class*="modal"]'
        ).forEach(el => el.style.setProperty('display', 'none', 'important'));
    });
}

// Scroll down repeatedly so lazy/infinite-scroll content has a chance to load
// before we try to find cards. Harmless for sites that don't need it.
async function scrollToLoadMore(page, steps = 6, pauseMs = 900) {
    for (let i = 0; i < steps; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await page.waitForTimeout(pauseMs);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
}

// Scans the live DOM for the most common "card-sized" ancestor around images,
// marks the winning set with a data attribute, and returns how many were found.
// (Images are only used as a layout signal to FIND article blocks on the
// page — nothing about them is ever saved or displayed.)
async function autoDetectCards(page, sizeWindow) {
    return await page.evaluate((win) => {
        const MARK_ATTR = 'data-capture-card';
        document.querySelectorAll(`[${MARK_ATTR}]`).forEach(el => el.removeAttribute(MARK_ATTR));

        const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const r = img.getBoundingClientRect();
            return r.width > 40 && r.height > 40;
        });

        const sigToEls = new Map();
        imgs.forEach(img => {
            let el = img;
            for (let depth = 0; depth < 6 && el.parentElement; depth++) {
                el = el.parentElement;
                const cls = (el.className && el.className.toString().trim()) || '';
                const sig = el.tagName + '|' + cls.replace(/\s+/g, '.');
                if (!sigToEls.has(sig)) sigToEls.set(sig, new Set());
                sigToEls.get(sig).add(el);
            }
        });

        let bestEls = [];
        for (const elSet of sigToEls.values()) {
            const inWindow = Array.from(elSet).filter(el => {
                const r = el.getBoundingClientRect();
                return r.width >= win.minWidth && r.width <= win.maxWidth &&
                       r.height >= win.minHeight && r.height <= win.maxHeight;
            });
            if (inWindow.length > bestEls.length) bestEls = inWindow;
        }

        bestEls.forEach((el, i) => el.setAttribute(MARK_ATTR, String(i)));
        return bestEls.length;
    }, sizeWindow);
}

// Card text often comes with trailing UI "chrome" scraped along with it —
// view/share counters, relative-time stamps like "5 س" (5 hours ago) — e.g.
// "...الإرهابية 58 س 5 3342". Strip short trailing runs of digit/single-
// letter tokens, but only at the very end, so a real figure embedded mid
// sentence ("مقتل 58 شخصا...") is never touched.
function cleanExtractedText(raw) {
    let text = (raw || '').replace(/\s+/g, ' ').trim();
    text = text.replace(/(?:\s+[\d٠-٩]{1,6}\s*[a-zA-Zء-ي]{0,2})+$/u, '').trim();
    return text;
}

function cacheBustedUrl(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_cb=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Builds a dedup key from BOTH the visible text and the card's first image
// URL (the URL string only — the image itself is never fetched/saved).
async function dedupKey(el) {
    const text = (await el.textContent() || '').trim();
    const textPart = text.substring(0, 100).replace(/\s+/g, '_');
    let imgPart = '';
    try {
        const img = await el.$('img');
        if (img) {
            const src = await img.getAttribute('src');
            if (src) imgPart = src.split('?')[0];
        }
    } catch (e) { /* ignore */ }
    return `${textPart}|${imgPart}`;
}

async function main() {
    console.log("--- DÉBUT DE L'EXTRACTION DES CARTES (texte uniquement, pas de capture d'écran) ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    let count = 0;
    const perSourceCounts = {};
    const capturedHashes = new Set();
    const cardsMeta = []; // parallel array: cardsMeta[i] describes card #i (text only)

    for (const source of sources) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });

        await page.setExtraHTTPHeaders({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        });

        perSourceCounts[source.name] = 0;

        try {
            const freshUrl = cacheBustedUrl(source.url);
            console.log(`\n📰 ${source.name}: ${freshUrl}`);
            await page.goto(freshUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);

            await hideOverlaysAndAds(page);

            console.log(`  ⬇ scrolling to trigger lazy-loaded content...`);
            await scrollToLoadMore(page);

            // some ads/popups animate in after scroll/delay -> sweep again
            await hideOverlaysAndAds(page);

            let elements = [];

            if (source.explicitSelector) {
                const candidates = await page.locator(source.explicitSelector).all();
                for (const el of candidates) {
                    const box = await el.boundingBox().catch(() => null);
                    if (box &&
                        box.width >= source.sizeWindow.minWidth && box.width <= source.sizeWindow.maxWidth &&
                        box.height >= source.sizeWindow.minHeight && box.height <= source.sizeWindow.maxHeight) {
                        elements.push(el);
                    }
                }
                console.log(`  🔍 explicit selector "${source.explicitSelector}": ${candidates.length} matched, ${elements.length} in size window`);
            }

            if (elements.length === 0) {
                console.log(`  🔍 falling back to auto-detect...`);
                const found = await autoDetectCards(page, source.sizeWindow);
                console.log(`  🔍 auto-detect found ${found} candidate cards`);
                if (found > 0) {
                    elements = await page.locator('[data-capture-card]').all();
                }
            }

            if (elements.length === 0) {
                console.log(`❌ ${source.name}: no cards found at all`);
                await page.screenshot({ path: `debug_${source.name}_noselectors.png`, fullPage: true });
                fs.writeFileSync(`debug_${source.name}.html`, await page.content());
                await page.close();
                continue;
            }

            let cardsCaptured = 0;
            let linksFound = 0;
            for (let i = 0; i < elements.length; i++) {
                try {
                    const el = elements[i];
                    await el.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(300);

                    const key = await dedupKey(el);
                    if (capturedHashes.has(key)) {
                        console.log(`  ⊘ Card ${i}: duplicate, skipped`);
                        continue;
                    }
                    capturedHashes.add(key);

                    // Text only — this is the entire extraction. No screenshot,
                    // no image of any kind is taken from the source page.
                    let summary = '';
                    try {
                        const cleaned = cleanExtractedText(await el.textContent());
                        summary = cleaned.length > 320 ? cleaned.slice(0, 320).trim() + '…' : cleaned;
                    } catch (e) { /* ignore, summary stays empty */ }

                    if (!summary) {
                        console.log(`  ⊘ Card ${i}: no extractable text, skipped`);
                        continue;
                    }

                    // article link, if the card itself (or something inside
                    // it) is/contains an <a> — lets analysis.js crawl the
                    // full article for a real summary instead of a template
                    let link = null;
                    try {
                        link = await el.evaluate((node) => {
                            // closest() covers "is an <a>" AND "is INSIDE an
                            // <a> ancestor" (a very common card pattern:
                            // <a href="..."><div class="card">...</div></a>,
                            // which a descendant-only querySelector would
                            // never find); querySelector covers the inverse
                            // (link nested somewhere inside the card).
                            const a = node.closest('a[href]') || node.querySelector('a[href]');
                            if (!a) return null;
                            try { return new URL(a.getAttribute('href'), document.baseURI).href; }
                            catch (e) { return null; }
                        });
                    } catch (e) { /* no link available, that's fine — fallback handles it */ }
                    if (link) linksFound++;

                    // source/sourceUrl are kept as internal metadata only
                    // (dedup, debugging) — index.html never displays them.
                    cardsMeta.push({
                        source: source.name,
                        sourceUrl: source.url,
                        summary,
                        link,
                        category: getCategoryFor(summary)
                    });

                    console.log(`✓ Card ${count} extracted (${source.name} #${i})`);
                    count++;
                    cardsCaptured++;

                } catch (e) {
                    console.warn(`  ⚠ Card ${i}: ${e.message}`);
                }
            }

            perSourceCounts[source.name] = cardsCaptured;
            console.log(`\n✓ ${source.name}: ${cardsCaptured} cards extracted — ${linksFound}/${cardsCaptured} with a usable article link\n`);

        } catch (e) {
            console.error(`❌ ${source.name} error:`, e.message);
        } finally {
            await page.close();
        }
    }

    // Crawls each card's full article (when a link was found) and locally
    // summarizes it — no API, nothing external beyond fetching the article
    // itself. Falls back to the rule-based generator per-item when there's
    // no link or the crawl fails.
    if (cardsMeta.length > 0) {
        console.log(`✍ generating analysis for ${cardsMeta.length} card(s) (full-article crawl + local summary)...`);
        const analyses = await getBatchAnalysis(cardsMeta.map(e => ({ text: e.summary || e.source, link: e.link })));
        cardsMeta.forEach((entry, i) => { entry.analysis = analyses[i]; });
    }

    fs.writeFileSync('total.json', JSON.stringify({ count }));
    fs.writeFileSync('cards.json', JSON.stringify(cardsMeta));
    console.log(`\n✅ Total: ${count} unique cards extracted`);
    console.log(`   Détail: ${JSON.stringify(perSourceCounts)}`);
    console.log(`--- FIN ---\n`);

    await browser.close();

    if (count === 0) {
        console.error("❌❌❌ AUCUNE CARTE EXTRAITE — échec du job pour alerter.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
