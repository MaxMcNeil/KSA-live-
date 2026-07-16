const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');

// Capture order == display order (cards are numbered sequentially as they're
// found), so this array order controls what plays first on the live view.
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
// screenshot anything. These are almost always position:fixed or
// position:sticky, which is exactly what makes them "bleed" into whichever
// card happens to be underneath them on screen. Real article cards are
// normally in-flow (static/relative), so this is safe and won't touch them.
async function hideOverlaysAndAds(page) {
    await page.evaluate(() => {
        document.querySelectorAll('body *').forEach(el => {
            const cs = getComputedStyle(el);
            if ((cs.position === 'fixed' || cs.position === 'sticky') &&
                el.offsetWidth > 0 && el.offsetHeight > 0) {
                el.style.setProperty('display', 'none', 'important');
            }
        });
        // common ad/consent/popup container patterns as a belt-and-braces extra pass
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

async function saveTrimmedScreenshot(el, outPath) {
    const buffer = await el.screenshot();
    try {
        await sharp(buffer)
            .trim({ background: '#ffffff', threshold: 12 })
            .toFile(outPath);
    } catch (e) {
        console.warn(`  ⚠ trim failed for ${outPath}, saving untrimmed: ${e.message}`);
        fs.writeFileSync(outPath, buffer);
    }
}

function cacheBustedUrl(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_cb=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Builds a dedup key from BOTH the visible text and the card's first image
// URL. Two DOM wrappers around the same underlying article will almost
// always share the same image src even if surrounding whitespace/text
// differs slightly, so this catches near-duplicates the old text-only hash missed.
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
    console.log("--- DÉBUT DE LA CAPTURE DES CARTES ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    let count = 0;
    const perSourceCounts = {};
    const capturedHashes = new Set();

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

                    await saveTrimmedScreenshot(el, `card_${count}.png`);
                    console.log(`✓ Card ${count} captured (${source.name} #${i})`);
                    count++;
                    cardsCaptured++;

                } catch (e) {
                    console.warn(`  ⚠ Card ${i}: ${e.message}`);
                }
            }

            perSourceCounts[source.name] = cardsCaptured;
            console.log(`\n✓ ${source.name}: ${cardsCaptured} cards captured\n`);

        } catch (e) {
            console.error(`❌ ${source.name} error:`, e.message);
        } finally {
            await page.close();
        }
    }

    fs.writeFileSync('total.json', JSON.stringify({ count }));
    console.log(`\n✅ Total: ${count} unique cards captured`);
    console.log(`   Détail: ${JSON.stringify(perSourceCounts)}`);
    console.log(`--- FIN ---\n`);

    await browser.close();

    if (count === 0) {
        console.error("❌❌❌ AUCUNE CARTE CAPTURÉE — échec du job pour alerter.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
