const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs qui ciblent le conteneur parent (image + texte)
    const targets = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card' }
    ];

    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    for (const target of targets) {
        console.log("Navigation :", target.url);
        await page.goto(target.url, { waitUntil: 'domcontentloaded' });
        
        // On attend que les cartes soient chargées
        await page.waitForSelector(target.selector, { timeout: 10000 }).catch(() => {});
        
        const elements = await page.locator(target.selector).all();
        // On ne prend que les 5 premières pour aller vite
        for (let i = 0; i < Math.min(elements.length, 5); i++) {
            await elements[i].screenshot({ path: path.join(tmpDir, `card_${target.url.includes('spa') ? 'spa' : 'akh'}_${i}.png`) });
        }
    }
    await browser.close();
}
capture();
