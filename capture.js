const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    // Taille fixe pour éviter le mode mobile qui cache du texte
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const tmpDir = './tmp_cards';
    
    // On cible des sélecteurs plus larges pour inclure le titre et l'image
    const targets = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.card' }
    ];

    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    for (const target of targets) {
        console.log("Navigation :", target.url);
        await page.goto(target.url, { waitUntil: 'load', timeout: 60000 });
        
        // Attendre que le contenu soit présent
        await page.waitForSelector(target.selector, { timeout: 20000 }).catch(() => {});
        
        // Scroll down pour forcer le chargement des images/textes (lazy loading)
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(2000); 
        
        const elements = await page.locator(target.selector).all();
        
        for (let i = 0; i < Math.min(elements.length, 5); i++) {
            // scrollIntoViewIfNeeded est la clé pour que le texte s'affiche correctement
            await elements[i].scrollIntoViewIfNeeded();
            await page.waitForTimeout(500); 
            
            await elements[i].screenshot({ 
                path: path.join(tmpDir, `card_${target.url.includes('spa') ? 'spa' : 'akh'}_${i}.png`),
                animations: 'disabled' // Désactive les animations pour éviter les captures floues
            });
        }
    }
    await browser.close();
}
capture();
