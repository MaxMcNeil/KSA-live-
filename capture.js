const { chromium } = require('playwright');
const fs = require('fs');

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
                'article',
                '[class*="post-card"]',
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
            
            let cardsFound = 0;
            let cardsCaptured = 0;
            
            // Try each selector until we find cards
            for (const selector of source.selectors) {
                const elements = await page.locator(selector).all();
                
                if (elements.length > 0) {
                    console.log(`✓ Found ${elements.length} cards with selector: ${selector}`);
                    cardsFound = elements.length;
                    
                    // Capture each card
                    for (let i = 0; i < elements.length; i++) {
                        try {
                            // Scroll card into view
                            await elements[i].scrollIntoViewIfNeeded();
                            await page.waitForTimeout(300);
                            
                            // Get element text for deduplication
                            const text = await elements[i].textContent();
                            const contentHash = text.trim().substring(0, 100).replace(/\s+/g, '_');
                            
                            // Skip duplicates
                            if (capturedHashes.has(contentHash)) {
                                console.log(`  ⊘ Card ${i}: duplicate, skipped`);
                                continue;
                            }
                            
                            capturedHashes.add(contentHash);
                            
                            // Get bounding box to ensure element is visible and sized properly
                            const box = await elements[i].boundingBox();
                            if (!box) {
                                console.log(`  ⚠ Card ${i}: cannot get bounding box, skipped`);
                                continue;
                            }
                            
                            // Skip very small elements (likely not actual cards)
                            if (box.width < 100 || box.height < 100) {
                                console.log(`  ⚠ Card ${i}: too small (${box.width}x${box.height}), skipped`);
                                continue;
                            }
                            
                            // Screenshot just this card element
                            await elements[i].screenshot({ path: `card_${count}.png` });
                            console.log(`✓ Card ${count} captured (${source.name} #${i}, ${box.width}x${box.height}px)`);
                            count++;
                            cardsCaptured++;
                            
                        } catch (e) {
                            console.warn(`  ⚠ Card ${i}: ${e.message}`);
                        }
                    }
                    
                    console.log(`\n✓ ${source.name}: ${cardsCaptured} cards captured from ${cardsFound} found\n`);
                    break; // Success with this selector, move to next source
                }
            }
            
            if (cardsFound === 0) {
                console.log(`❌ ${source.name}: No cards found with any selector`);
                await page.screenshot({ path: `debug_${source.name}_noselectors.png` });
                
                // Debug: show page structure
                const structure = await page.evaluate(() => ({
                    title: document.title,
                    url: window.location.href,
                    bodyHTML: document.body.innerHTML.substring(0, 500)
                }));
                console.log(`Page structure:`, structure.title, structure.url);
            }
            
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
