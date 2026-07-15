const { chromium } = require('playwright');
const fs = require('fs');

// Expected card size window — tune these to match the real cards on each site.
// From your screenshot, SPA cards look roughly 300-460px wide, 350-560px tall.
const SIZE_WINDOW = {
    minWidth: 200, maxWidth: 500,
    minHeight: 250, maxHeight: 600
};

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE DES CARTES ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });

    const sources = [
        {
            url: 'https://www.spa.gov.sa/media?page=1&type=3',
            name: 'SPA',
            selectors: [
                'a.col-md-6',
                'div.col-md-6',
                '.media-card',
                '[class*="media-item"]',
                '[class*="media-card"]',
                '[class*="card"]',
                'a[href*="/media"]'
            ]
        },
        {
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB',
            name: 'Akhbaar24',
            selectors: [
                '.news-card',
                'a.news-card',
                '[class*="news-item"]',
                '[class*="post-card"]',
                'article',
                'a[href*="/news"]'
            ]
        }
    ];

    let count = 0;
    const capturedHashes = new Set();

    for (const source of sources) {
        const page = await browser.newPage({
            viewport: { width: 800, height: 600 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });

        try {
            console.log(`\n📰 ${source.name}: ${source.url}`);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);

            // --- Step 1: find the BEST selector, not just the first that matches anything ---
            let bestSelector = null;
            let bestElements = [];
            let bestScore = 0;

            for (const selector of source.selectors) {
                const elements = await page.locator(selector).all();
                if (elements.length === 0) continue;

                // Count how many elements actually fall inside our expected card size window
                let inWindow = 0;
                const boxes = [];
                for (const el of elements) {
                    const box = await el.boundingBox().catch(() => null);
                    boxes.push(box);
                    if (
                        box &&
                        box.width >= SIZE_WINDOW.minWidth && box.width <= SIZE_WINDOW.maxWidth &&
                        box.height >= SIZE_WINDOW.minHeight && box.height <= SIZE_WINDOW.maxHeight
                    ) {
                        inWindow++;
                    }
                }

                console.log(`  🔍 "${selector}": ${elements.length} matched, ${inWindow} in size window`);

                if (inWindow > bestScore) {
                    bestScore = inWindow;
                    bestSelector = selector;
                    bestElements = elements;
                }
            }

            if (!bestSelector || bestScore === 0) {
                console.log(`❌ ${source.name}: no selector produced properly-sized cards`);
                await page.screenshot({ path: `debug_${source.name}_noselectors.png`, fullPage: true });
                const html = await page.content();
                fs.writeFileSync(`debug_${source.name}.html`, html);
                await page.close();
                continue;
            }

            console.log(`✓ Using selector "${bestSelector}" (${bestScore} cards in window)`);

            let cardsCaptured = 0;
            for (let i = 0; i < bestElements.length; i++) {
                try {
                    const el = bestElements[i];
                    await el.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(300);

                    const box = await el.boundingBox();
                    if (!box) { console.log(`  ⚠ Card ${i}: no bounding box, skipped`); continue; }

                    // Reject anything outside the expected card size window (catches wrapper/nav elements)
                    if (
                        box.width < SIZE_WINDOW.minWidth || box.width > SIZE_WINDOW.maxWidth ||
                        box.height < SIZE_WINDOW.minHeight || box.height > SIZE_WINDOW.maxHeight
                    ) {
                        console.log(`  ⚠ Card ${i}: size ${Math.round(box.width)}x${Math.round(box.height)} outside window, skipped`);
                        continue;
                    }

                    const text = await el.textContent();
                    const contentHash = text.trim().substring(0, 100).replace(/\s+/g, '_');
                    if (capturedHashes.has(contentHash)) {
                        console.log(`  ⊘ Card ${i}: duplicate, skipped`);
                        continue;
                    }
                    capturedHashes.add(contentHash);

                    await el.screenshot({ path: `card_${count}.png` });
                    console.log(`✓ Card ${count} captured (${source.name} #${i}, ${Math.round(box.width)}x${Math.round(box.height)}px)`);
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
                
