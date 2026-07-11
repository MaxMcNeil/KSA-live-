const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // On cible le contenu dynamique avec des sélecteurs plus génériques
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: 'div[class*="media-card"], article, div[class*="item"]' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: 'div[class*="news-card"], div[class*="col-"]' }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            console.log("Navigation vers :", source.url);
            // On utilise 'networkidle' mais avec un timeout très court pour ne pas bloquer
            await page.goto(source.url, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
            
            // On attend que les éléments apparaissent dans le DOM
            await page.waitForSelector(source.selector, { timeout: 10000 }).catch(() => {});
            
            const found = await page.locator(source.selector).all();
            // On filtre pour ne prendre que les éléments ayant une taille réelle (visibles)
            for (const el of found) {
                const box = await el.boundingBox();
                if (box && box.height > 100 && box.width > 100) {
                    allCards.push(el);
                }
            }
            console.log(`Trouvé ${allCards.length} éléments visibles sur ${source.url}`);
        }

        const limit = Math.min(allCards.length, 20);
        if (limit === 0) throw new Error("Aucune carte trouvée après forçage.");

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            try {
                await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`), timeout: 5000 });
                fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
            } catch (e) { continue; }
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
