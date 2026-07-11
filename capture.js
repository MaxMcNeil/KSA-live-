const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs plus larges pour SPA pour garantir le succès de la récupération
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card, article' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4, .news-card' }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            try {
                console.log("Navigation vers :", source.url);
                // On utilise domcontentloaded pour ne pas attendre que les pubs chargent
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(4000); // Temps de sécurité pour le rendu JS
                
                const found = await page.locator(source.selector).all();
                console.log(`Trouvé ${found.length} éléments sur ${source.url}`);
                allCards.push(...found);
            } catch (err) {
                console.warn(`Avertissement : échec sur ${source.url}, on continue.`);
            }
        }

        const limit = Math.min(allCards.length, 20);
        if (limit === 0) throw new Error("Aucune carte trouvée.");

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            // On tente la capture, si une échoue on passe à la suivante
            try {
                await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`), timeout: 5000 });
                fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
            } catch (e) {
                console.warn(`Impossible de capturer l'élément ${i}`);
            }
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
        
