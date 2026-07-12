const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    
    const sources = [
        { 
            url: 'https://www.spa.gov.sa/media?page=1&type=3', 
            selectors: [
                'a.col-md-6',
                'div.col-md-6 a',
                '.col-md-6',
                'a[href*="/media"]',
                '[class*="media-item"]'
            ],
            name: 'SPA' 
        },
        { 
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', 
            selectors: [
                '.news-card',
                'a.news-card',
                '[class*="news-item"]',
                'article',
                'a[href*="/news"]',
                '.post-card'
            ],
            name: 'Akhbaar24' 
        }
    ];

    let count = 0;
    
    for (const s of sources) {
        // Create a NEW page for each source to avoid state issues
        const page = await browser.newPage({ 
            viewport: { width: 800, height: 600 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        
        try {
            console.log(`\n📰 Navigation vers ${s.name}: ${s.url}`);
            await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Wait for content to load
            await page.waitForTimeout(3000);
            
            // Try each selector until we find distinct cards
            let elements = [];
            let foundSelector = '';
            
            for (const selector of s.selectors) {
                elements = await page.locator(selector).all();
                
                if (elements.length > 0) {
                    console.log(`✓ Trouvé ${elements.length} éléments avec: ${selector}`);
                    
                    // Filter out very small elements (likely not actual cards)
                    const validElements = [];
                    for (const el of elements) {
                        const box = await el.boundingBox();
                        if (box && box.width > 150 && box.height > 100) {
                            validElements.push(el);
                        }
                    }
                    
                    if (validElements.length > 0) {
                        console.log(`✓ After filtering: ${validElements.length} valid cards`);
                        elements = validElements;
                        foundSelector = selector;
                        break;
                    } else {
                        console.log(`  ⚠ Tous les éléments sont trop petits, essai du sélecteur suivant...`);
                    }
                }
            }
            
            if (elements.length === 0) {
                console.log(`❌ Aucun élément trouvé avec les sélecteurs fournis`);
                
                // Dump page structure for debugging
                const structure = await page.evaluate(() => {
                    const elements = document.querySelectorAll('[class*="col"], [class*="card"], [class*="item"], [class*="media"], article');
                    return Array.from(elements).slice(0, 20).map(el => ({
                        tag: el.tagName,
                        class: el.className,
                        text: el.textContent?.substring(0, 50),
                        width: el.offsetWidth,
                        height: el.offsetHeight
                    }));
                });
                
                console.log(`Page structure:`, JSON.stringify(structure, null, 2));
                await page.screenshot({ path: `debug_${s.name}.png` });
                console.log(`Screenshot sauvegardé: debug_${s.name}.png`);
            } else {
                // Capture unique cards only (avoid duplicates)
                const capturedTexts = new Set(); // Track captured content to avoid dupes
                
                for (let i = 0; i < Math.min(elements.length, 10); i++) {
                    try {
                        await elements[i].scrollIntoViewIfNeeded();
                        await page.waitForTimeout(300);
                        
                        // Get element text to check for duplicates
                        const text = await elements[i].textContent();
                        const textHash = text.substring(0, 100);
                        
                        if (capturedTexts.has(textHash)) {
                            console.log(`  ⊘ Élément ${i} est un doublon, ignoré`);
                            continue;
                        }
                        
                        capturedTexts.add(textHash);
                        await elements[i].screenshot({ path: `card_${count}.png` });
                        console.log(`✓ Capture ${count} générée (${s.name} #${i})`);
                        count++;
                    } catch (e) {
                        console.warn(`  ⚠ Impossible de capturer l'élément ${i}: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            console.error(`❌ Erreur source ${s.name}:`, e.message);
            try {
                await page.screenshot({ path: `debug_${s.name}_error.png` });
            } catch (err) {
                console.error(`Impossible de sauvegarder le screenshot:`, err.message);
            }
        } finally {
            await page.close(); // Always close the page
        }
    }
    
    fs.writeFileSync('total.json', JSON.stringify({ count }));
    console.log(`\n✓ Fichier total.json mis à jour: ${count} cartes`);
    
    await browser.close();
    console.log(`--- FIN : ${count} cartes générées ---\n`);
}

main().catch(err => {
    console.error("Erreur fatale:", err);
    process.exit(1);
});
