const { chromium } = require('playwright');
const fs = require('fs');

const sources = [
    {
        name: 'SPA',
        url: 'https://www.spa.gov.sa/media?page=1&type=3',
        // Verified from live markup: MuiGrid-item / MuiGrid-grid-md-3 are stable Material-UI
        // framework classes (not the random hashed muirtl-xxxx ones), so this is safe to hardcode.
        explicitSelector: '.MuiGrid-item.MuiGrid-grid-md-3.MuiGrid-grid-lg-3',
        sizeWindow: { minWidth: 180, maxWidth: 420, minHeight: 220, maxHeight: 550 }
    },
    {
        name: 'Akhbaar24',
        url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB',
        // No confirmed selector yet -> rely on auto-detection below.
        explicitSelector: null,
        sizeWindow: { minWidth: 200, maxWidth: 480, minHeight: 220, maxHeight: 550 }
    }
];

// Scans the live DOM for the most common "card-sized" ancestor around images,
// marks the winning set with a data attribute, and returns how many were found.
async function autoDetectCards(page, sizeWindow) {
    return await page.evaluate((win) => {
        const MARK_ATTR = 'data-capture-card';
        document.querySelectorAll(`[${MARK_ATTR}]`).forEach(el => el.removeAttribute(MARK_ATTR));

        const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const r = img.getBoundingClientRect();
            return r.width > 40 && r.height > 40; // skip tiny icons/logos
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

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE DES CARTES ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    let count = 0;
    const capturedHashes = new Set();

    for (const source of sources) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });

        try {
            console.log(`\n📰 ${source.name}: ${source.url}`);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);

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

                    const text = (await el.textContent() || '').trim();
                    const contentHash = text.substring(0, 100).replace(/\s+/g, '_');
                    if (capturedHashes.has(contentHash)) {
                        console.log(`  ⊘ Card ${i}: duplicate, skipped`);
                        continue;
                    }
                    capturedHashes.add(contentHash);

                    await el.screenshot({ path: `card_${count}.png` });
                    console.log(`✓ Card ${count} captured (${source.name} #${i})`);
                    count++;
                    cardsCaptured++;

                } catch (e) {
                    console.warn(`  ⚠ Card ${i}: ${e.message}`);
                }
            }

            console.log(`\n✓ ${source.name}: ${cardsCaptured} cards captured\n`);

        } catch (e) {
            console.error(`❌ ${source.name} error:`, e.message);
        } finally {
            await page.close();
        }
    }

    fs.writeFileSync('total.json', JSON.stringify({ count }));
    console.log(`\n✅ Total: ${count} unique cards captured`);
    console.log(`--- FIN ---\n`);

    await browser.close();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
