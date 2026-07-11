const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // On définit les sources
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card, .card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4, .news-card, article' }
    ];

    try {
        let allCards = [];

        // On boucle sur chaque source pour cumuler
        for (const source of sources) {
            console.log("Exploration de:", source.url);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(5000);
            
            const found = await page.locator(source.selector).all();
            console.log(`Trouvé ${found.length} cartes sur cette source.`);
            allCards.push(...found); // On ajoute tout au tableau global
        }
        
        console.log("Total cartes cumulées:", allCards.length);
        if (allCards.length === 0) throw new Error("Aucune carte trouvée sur aucune source.");

        // On limite à 10 pour garder une boucle de 70 secondes (10 * 7s)
        const limit = Math.min(allCards.length, 10);

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
        }
        
        for (let i = 0; i < limit; i++) {
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        console.log(`Capture réussie : ${limit} cartes déployées.`);
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
            
