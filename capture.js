const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    // On définit une taille de fenêtre large pour que le texte soit bien affiché
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const tmpDir = './tmp_cards';
    
    // Nouveaux sélecteurs plus larges pour inclure le texte
    const targets = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card' }
    ];

    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    for (const target of targets) {
        console.log("Navigation :", target.url);
        await page.goto(target.url, { waitUntil: 'networkidle' }); // On attend le chargement complet
        
        await page.waitForSelector(target.selector, { timeout: 10000 });
        
        const elements = await page.locator(target.selector).all();
        for (let i = 0; i < Math.min(elements.length, 5); i++) {
            // On ajoute un petit scroll pour s'assurer que l'élément est bien "peint" par le navigateur
            await elements[i].scrollIntoViewIfNeeded();
            await page.waitForTimeout(1000); 
            
            await elements[i].screenshot({ 
                path: path.join(tmpDir, `card_${target.url.includes('spa') ? 'spa' : 'akh'}_${i}.png`),
                omitBackground: false // On garde le fond pour que le texte soit lisible
            });
        }
    }
    await browser.close();
}
capture();
