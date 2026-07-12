const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE ---");
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ 
        viewport: { width: 800, height: 600 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const sources = [
        { 
            url: 'https://www.spa.gov.sa/media?page=1&type=3', 
            selectors: ['.media-card', '[class*="card"]', '.item', '[class*="media"]'],
            name: 'SPA' 
        },
        { 
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', 
            selectors: ['.news-card', '.news-item', '[class*="news"]', 'article'],
            name: 'Akhbaar24' 
        }
    ];

    let count = 0;
    
    for (const s of sources) {
        try {
            console.log(`\n📰 Navigation vers ${s.name}: ${s.url}`);
            await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Wait a bit for content to load
            await page.waitForTimeout(2000);
            
            // Try each selector until we find elements
            let elements = [];
            for (const selector of s.selectors) {
                elements = await page.locator(selector).all();
                if (elements.length > 0) {
                    console.log(`✓ Trouvé ${elements.length} éléments avec le sélecteur: ${selector}`);
                    break;
                }
            }
            
            if (elements.length === 0) {
                console.log(`⚠ Aucun élément trouvé avec les sélecteurs fournis`);
                // Save page screenshot for debugging
                await page.screenshot({ path: `debug_${s.name}.png` });
                console.log(`Sauvegardé screenshot de débogage: debug_${s.name}.png`);
                continue;
            }
            
            // Capture up to 10 elements
            for (let i = 0; i < Math.min(elements.length, 10); i++) {
                try {
                    await elements[i].screenshot({ path: `card_${count}.png` });
                    console.log(`✓ Capture ${count} générée (${s.name} #${i})`);
                    count++;
                } catch (e) {
                    console.warn(`  ⚠ Impossible de capturer l'élément ${i}: ${e.message}`);
                }
            }
        } catch (e) {
            console.error(`❌ Erreur source ${s.name}:`, e.message);
            try {
                await page.screenshot({ path: `debug_${s.name}_error.png` });
                console.log(`Sauvegardé screenshot d'erreur: debug_${s.name}_error.png`);
            } catch (screenshotError) {
                console.error(`Impossible de sauvegarder le screenshot:`, screenshotError.message);
            }
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
