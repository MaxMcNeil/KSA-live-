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
            
            // Save full page screenshot
            await page.screenshot({ path: `debug_${s.name}_full.png` });
            console.log(`✓ Screenshot sauvegardé: debug_${s.name}_full.png`);
            
            // Get page HTML and save it
            const html = await page.content();
            fs.writeFileSync(`debug_${s.name}.html`, html);
            console.log(`✓ HTML sauvegardé: debug_${s.name}.html`);
            
            // Parse HTML with cheerio to analyze structure
            const $ = cheerio.load(html);
            
            // Log all images on page to understand structure
            const images = $('img');
            console.log(`\n✓ Total images trouvées: ${images.length}`);
            
            // Look for common card/article containers
            const possibleSelectors = [
                { selector: '[class*="card"]', name: 'class contains card' },
                { selector: '[class*="item"]', name: 'class contains item' },
                { selector: '[class*="media"]', name: 'class contains media' },
                { selector: '[class*="col"]', name: 'class contains col' },
                { selector: 'article', name: 'article tags' },
                { selector: 'a[href]', name: 'all links' },
                { selector: 'div[class][class*="media"]', name: 'div with media class' },
                { selector: '[class*="infografic"]', name: 'infografic' },
                { selector: '[class*="gallery"]', name: 'gallery' }
            ];
            
            console.log(`\nAnalyzing possible selectors for ${s.name}:`);
            for (const { selector, name } of possibleSelectors) {
                const matches = $(selector).length;
                if (matches > 0 && matches < 100) {
                    console.log(`  ${name}: ${matches} éléments`);
                    
                    // Show first element details
                    const first = $(selector).first();
                    const html = first.html();
                    if (html) {
                        console.log(`    Aperçu: ${html.substring(0, 100)}...`);
                    }
                }
            }
            
            // Find all clickable elements with images/links
            console.log(`\nRecherche d'éléments cliquables avec images:`);
            const clickables = $('a, button, [role="button"], [onclick]');
            let imageCount = 0;
            clickables.each((i, el) => {
                if (i < 5) { // Show first 5
                    const $el = $(el);
                    const hasImg = $el.find('img').length > 0;
                    const href = $el.attr('href');
                    const classes = $el.attr('class');
                    if (hasImg || href) {
                        console.log(`  [${i}] ${$el.prop('tagName')} - class="${classes}" href="${href}" - has_img: ${hasImg}`);
                        imageCount++;
                    }
                }
            });
            
            // Try generic card capture: divs containing images and links
            console.log(`\nStratégie de fallback: capture par position`);
            const allDivs = $('div[class]');
            const potentialCards = [];
            
            allDivs.each((i, el) => {
                const $el = $(el);
                const hasImg = $el.find('img').length > 0;
                const hasLink = $el.find('a').length > 0;
                const childCount = $el.children().length;
                
                // Card-like element: has image, link, and reasonable children count
                if (hasImg && hasLink && childCount > 2 && childCount < 20) {
                    potentialCards.push({
                        index: i,
                        class: $el.attr('class'),
                        children: childCount,
                        images: $el.find('img').length,
                        links: $el.find('a').length
                    });
                }
            });
            
            console.log(`Trouvé ${potentialCards.length} éléments potentiellement des cartes`);
            potentialCards.slice(0, 5).forEach((card, idx) => {
                console.log(`  Card ${idx}: class="${card.class}" - ${card.children} children, ${card.images} images, ${card.links} links`);
            });
            
            // Now attempt capture using image-based detection
            console.log(`\n📸 Tentative de capture par images...`);
            const allImages = $('img');
            const capturedTexts = new Set();
            let captured = 0;
            
            for (let i = 0; i < Math.min(allImages.length, 20); i++) {
                const $img = $(allImages[i]);
                
                // Get image dimensions to filter out small icons
                const src = $img.attr('src');
                const alt = $img.attr('alt') || '';
                const parent = $img.parent();
                const parentClass = parent.attr('class') || '';
                
                if (!src) continue;
                
                // Try to get the clickable parent (link or button)
                let clickable = parent;
                if (!clickable.is('a, button, [role="button"]')) {
                    clickable = $img.closest('a, button, [role="button"], [onclick], div.col-md-6, [class*="card"], [class*="item"]');
                }
                
                if (!clickable || clickable.length === 0) continue;
                
                // Get text for dedup
                const text = clickable.text().trim().substring(0, 100);
                
                if (text && capturedTexts.has(text)) {
                    console.log(`  ⊘ Image ${i} est probable doublon (texte: ${text.substring(0, 30)}...)`);
                    continue;
                }
                
                if (text) capturedTexts.add(text);
                
                try {
                    // Try to screenshot the clickable element
                    const locator = page.locator(`text="${text.substring(0, 30)}"`).first();
                    if (await locator.isVisible()) {
                        await locator.scrollIntoViewIfNeeded();
                        await page.waitForTimeout(200);
                        await locator.screenshot({ path: `card_${count}.png` });
                        console.log(`✓ Capture ${count} générée (${s.name} #${i}, texte: ${text.substring(0, 30)}...)`);
                        count++;
                    }
                } catch (e) {
                    console.warn(`  ⚠ Impossible de capturer image ${i}: ${e.message}`);
                }
            }
            
        } catch (e) {
            console.error(`❌ Erreur ${s.name}:`, e.message);
        } finally {
            await page.close();
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
