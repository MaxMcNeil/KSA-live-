const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs plus larges pour ne rien rater
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4' }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            console.log("Navigation vers :", source.url);
            
            // 1. Navigation simple sans attendre le réseau (rapide)
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            // 2. Attente active : on attend que les cartes soient là
            await page.waitForSelector(source.selector, { timeout: 15000 }).catch(() => {});
            
            // 3. Petite pause pour laisser le JS finir de remplir les images
            await page.waitForTimeout(5000); 
            
            const found = await page.locator(source.selector).all();
            console.log(`Trouvé ${found.length} éléments potentiels sur ${source.url}`);
            
            for (const el of found) {
                const box = await el.boundingBox();
                // On vérifie que l'élément est bien visible et a une taille
                if (box && box.height > 100 && box.width > 100) {
                    allCards.push(el);
                }
            }
        }

        const limit = Math.min(allCards.length, 20);
        if (limit === 0) throw new Error("Aucune carte trouvée, les sélecteurs sont peut-être obsolètes.");

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        
        console.log("Succès :", limit, "cartes capturées.");
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
