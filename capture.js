const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Liste des sources à tester
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card, .card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4, .news-card, article' }
    ];

    try {
        let cards = [];
        // Tenter de capturer depuis SPA d'abord, sinon Akhbaar24
        for (const source of sources) {
            console.log("Tentative de capture sur:", source.url);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(5000);
            cards = await page.locator(source.selector).all();
            if (cards.length >= 5) break;
        }
        
        console.log("Cartes trouvées:", cards.length);
        if (cards.length < 5) throw new Error(`Pas assez de cartes trouvées : ${cards.length}`);

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < 5; i++) {
            await cards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
        }
        
        for (let i = 0; i < 5; i++) {
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        console.log("Capture réussie.");
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
