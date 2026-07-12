const { chromium } = require('playwright');
const fs = require('fs');
const cheerio = require('cheerio');

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    
    const sources = [
        { 
            url: 'https://www.spa.gov.sa/media?page=1&type=3',
            name: 'SPA' 
        },
        { 
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB',
            name: 'Akhbaar24' 
        }
    ];

    let count = 0;
    const capturedHashes = new Set(); // Track captured content by hash to avoid duplicates
    
    for (const s of sources) {
        const page = await browser.newPage({ 
            viewport: { width: 800, height: 600 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        
        try {
            console.log(`\n📰 Navigation vers ${s.name}: ${s.url}`);
            await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Wait for content to fully load
            await page.waitForTimeout(3000);
            
            // Get page HTML and parse with cheerio
            const html = await page.content();
            const $ = cheerio.load(html);
            
            console.log(`\n🔍 Analyzing ${s.name} page structure...`);
            
            // Find all potential clickable card elements
            let cardElements = [];
            
            if (s.name === 'SPA') {
                // For SPA: Look for media cards - typically col-md-6 or similar with links
                cardElements = $('a.col-md-6, div.col-md-6 a, a[href*="/media"]').toArray();
                console.log(`Found ${cardElements.length} potential SPA cards`);
                
                if (cardElements.length === 0) {
                    // Fallback: any link with image
                    cardElements = $('a[href] img').parent().toArray();
                    console.log(`Fallback: Found ${cardElements.length} cards with images`);
                }
            } else {
                // For Akhbaar24: Look for news cards
                cardElements = $('a.news-card, .news-item a, article a, a[href*="/news"]').toArray();
                console.log(`Found ${cardElements.length} potential Akhbaar24 cards`);
                
                if (cardElements.length === 0) {
                    // Fallback: any article or card-like container
                    cardElements = $('article, [class*="news"], [class*="post"]').toArray();
                    console.log(`Fallback: Found ${cardElements.length} article containers`);
                }
            }
            
            // Filter and capture cards
            console.log(`\n📸 Capturing cards from ${s.name}...`);
            let sourceCount = 0;
            
            for (let i = 0; i < Math.min(cardElements.length, 15); i++) {
                try {
                    const $el = $(cardElements[i]);
                    
                    // Get element text for deduplication
                    const text = $el.text().trim();
                    const href = $el.attr('href') || '';
                    const contentHash = `${text.substring(0, 50)}_${href}`.replace(/\s+/g, '_');
                    
                    // Skip if we've already captured this content
                    if (capturedHashes.has(contentHash)) {
                        console.log(`  ⊘ Card ${i} is a duplicate, skipping`);
                        continue;
                    }
                    
                    capturedHashes.add(contentHash);
                    
                    // Get the clickable link (could be the element itself or a child/parent)
                    let link = $el;
                    if (!link.is('a')) {
                        link = $el.find('a').first();
                        if (link.length === 0) {
                            link = $el.closest('a');
                        }
                    }
                    
                    if (link.length === 0) {
                        console.log(`  ⚠ Card ${i}: No clickable link found`);
                        continue;
                    }
                    
                    const href_val = link.attr('href') || '';
                    const cardText = link.text().trim().substring(0, 40);
                    
                    // Navigate to the card if it has a link, or screenshot in place
                    if (href_val && !href_val.startsWith('#')) {
                        try {
                            // Navigate to card detail page
                            const cardUrl = href_val.startsWith('http') ? href_val : new URL(href_val, s.url).href;
                            console.log(`  → Navigating to card: ${cardUrl.substring(0, 60)}...`);
                            
                            await page.goto(cardUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                            await page.waitForTimeout(1000);
                            
                            // Take screenshot of card detail page
                            await page.screenshot({ path: `card_${count}.png` });
                            console.log(`✓ Capture ${count} générée (${s.name} #${i} - ${cardText})`);
                            count++;
                            sourceCount++;
                            
                            // Return to main page
                            await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.waitForTimeout(2000);
                            
                        } catch (e) {
                            console.warn(`  ⚠ Failed to navigate to card ${i}: ${e.message}`);
                            // Go back to main page
                            try {
                                await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                            } catch (err) {
                                console.error(`  ❌ Failed to return to main page`);
                                break;
                            }
                        }
                    } else {
                        // No href, try to screenshot the element in place
                        try {
                            // Scroll to element and take screenshot
                            const elementLocator = page.locator(`text="${cardText}"`).first();
                            if (await elementLocator.isVisible()) {
                                await elementLocator.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(300);
                                await elementLocator.screenshot({ path: `card_${count}.png` });
                                console.log(`✓ Capture ${count} générée (${s.name} #${i} - ${cardText})`);
                                count++;
                                sourceCount++;
                            }
                        } catch (e) {
                            console.warn(`  ⚠ Cannot screenshot element ${i}: ${e.message}`);
                        }
                    }
                    
                    // Stop if we have enough cards from this source
                    if (sourceCount >= 10) {
                        console.log(`  ✓ Reached 10 cards from ${s.name}, moving to next source`);
                        break;
                    }
                    
                } catch (e) {
                    console.error(`  ❌ Error processing card ${i}:`, e.message);
                }
            }
            
            if (sourceCount === 0) {
                console.log(`⚠ No cards captured from ${s.name}, saving debug info...`);
                await page.screenshot({ path: `debug_${s.name}_failed.png` });
                const structure = await page.evaluate(() => {
                    return {
                        title: document.title,
                        images: document.querySelectorAll('img').length,
                        links: document.querySelectorAll('a').length,
                        divs: document.querySelectorAll('div').length
                    };
                });
                console.log(`Page structure:`, JSON.stringify(structure, null, 2));
            }
            
        } catch (e) {
            console.error(`❌ Error processing ${s.name}:`, e.message);
        } finally {
            await page.close();
        }
    }
    
    fs.writeFileSync('total.json', JSON.stringify({ count }));
    console.log(`\n✅ Fichier total.json mis à jour: ${count} cartes uniques`);
    
    await browser.close();
    console.log(`--- FIN : ${count} cartes générées ---\n`);
}

main().catch(err => {
    console.error("Erreur fatale:", err);
    process.exit(1);
});
