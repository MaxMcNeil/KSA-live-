const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    const tmpDir = './tmp_cards';
    
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const targets = [
        { 
            url: 'https://www.spa.gov.sa/media?page=1&type=3', 
            // On cible l'élément parent le plus large possible
            selector: '.media-card' 
        },
        { 
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', 
            // On utilise un sélecteur plus large pour inclure le titre
            selector: '.row .col-md-4' 
        }
    ];

    for (const target of targets) {
        console.log("Navigation :", target.url);
        await page.goto(target.url, { waitUntil: 'load', timeout: 60000 });
        
        // On attend que les éléments soient bien là
        await page.waitForTimeout(3000);
        
        const elements = await page.locator(target.selector).all();
        console.log(`Éléments trouvés pour ${target.url}: ${elements.length}`);
        
        for (let i = 0; i < Math.min(elements.length, 4); i++) {
            await elements[i].scrollIntoViewIfNeeded();
            
            // Capture du bloc complet
            await elements[i].screenshot({ 
                path: path.join(tmpDir, `card_${target.url.includes('spa') ? 'spa' : 'akh'}_${i}.png`),
                animations: 'disabled'
            });
        }
    }
    await browser.close();
}
capture();
        
