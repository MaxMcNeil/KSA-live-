const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 1200 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs ultra-ciblés : on cherche des éléments qui ont une image ET un titre
    const sources = [
        { 
            url: 'https://www.spa.gov.sa/media?page=1&type=3', 
            // On cible les éléments qui ont une classe liée à 'card' ET qui contiennent une image
            selector: '.media-card:has(img):has(h2)' 
        },
        { 
            url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', 
            // On cible les colonnes qui contiennent une image ET un titre h3
            selector: '.col-md-4:has(img):has(h3), .news-card:has(img):has(h3)' 
        }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            console.log("Navigation vers :", source.url);
            await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(5000); // Temps nécessaire pour que les images chargent
            
            const found = await page.locator(source.selector).all();
            
            // Filtre supplémentaire : on ne garde que les éléments qui ont une surface d'affichage correcte
            for (const el of found) {
                const box = await el.boundingBox();
                if (box && box.height > 150 && box.width > 150) {
                    allCards.push(el);
                }
            }
            console.log(`Trouvé ${allCards.length} cartes valides sur ${source.url}`);
        }

        const limit = Math.min(allCards.length, 20);
        if (limit === 0) throw new Error("Aucune carte valide trouvée avec le nouveau sélecteur.");

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            try {
                await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`), timeout: 10000 });
                fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
            } catch (e) {
                console.warn(`Échec capture carte ${i}`);
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
