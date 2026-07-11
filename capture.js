const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs élargis pour les deux sources
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: 'article, .media-card, .card, div[class*="card"], div[class*="item"]' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4, .news-card, article, .col-sm-6' }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            try {
                console.log("Exploration de la source :", source.url);
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(6000);
                
                const found = await page.locator(source.selector).all();
                console.log(`Trouvé ${found.length} éléments sur ${source.url}`);
                
                if (found.length > 0) {
                    allCards.push(...found);
                }
            } catch (err) {
                console.warn(`Avertissement : impossible de charger ${source.url} (${err.message})`);
            }
        }

        if (allCards.length === 0) {
            throw new Error("Aucune carte trouvée sur l'ensemble des sources.");
        }

        const limit = Math.min(allCards.length, 20);
        console.log(`Total cumulé retenu pour le direct : ${limit} cartes.`);

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        // Boucle de capture avec sécurité intégrée
        for (let i = 0; i < limit; i++) {
            try {
                await allCards[i].scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
                await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`), timeout: 10000 });
            } catch (err) {
                console.warn(`Impossible de capturer la carte ${i}, passage à la suivante.`);
            }
        }
        
        // Copie des fichiers capturés
        for (let i = 0; i < limit; i++) {
            const filePath = path.join(tmpDir, `card_${i}.png`);
            if (fs.existsSync(filePath)) {
                fs.copyFileSync(filePath, `card_${i}.png`);
            }
        }
        
        // Nettoyage des anciens fichiers
        for (let i = limit; i < 20; i++) {
            if (fs.existsSync(`card_${i}.png`)) {
                fs.unlinkSync(`card_${i}.png`);
            }
        }

        console.log("Capture et mixage réussis.");
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
