const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs élargis pour être sûr de tout attraper sur les deux sites
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
                await page.waitForTimeout(6000); // Un peu plus de temps pour charger les éléments dynamiques de la SPA
                
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

        // On prend tout ce qui est disponible, plafonné à 20 max pour garder une rotation fluide
        const limit = Math.min(allCards.length, 20);
        console.log(`Total cumulé retenu pour le direct : ${limit} cartes.`);

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
        }
        
        for (let i = 0; i < limit; i++) {
            if (!fs.existsSync(path.join(tmpDir, `card_${i}.png`))) {
                throw new Error(`Erreur : card_${i}.png manquant.`);
            }
        }
        
        for (let i = 0; i < limit; i++) {
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        
        // Nettoyage des anciennes images au-delà du nouveau total pour éviter les fantômes
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
