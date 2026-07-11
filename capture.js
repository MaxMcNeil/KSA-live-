const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sélecteurs précis : on ne prend que les éléments qui ont une balise <img> dedans
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card:has(img)' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card:has(img), .col-md-4:has(img)' }
    ];

    let allCards = [];

    try {
        for (const source of sources) {
            await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);
            
            const found = await page.locator(source.selector).all();
            console.log(`Trouvé ${found.length} cartes valides sur ${source.url}`);
            allCards.push(...found);
        }

        const limit = Math.min(allCards.length, 20);
        if (limit === 0) throw new Error("Aucune carte avec image trouvée.");

        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        for (let i = 0; i < limit; i++) {
            // Capture directe du conteneur identifié
            await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
            console.log(`Carte ${i} capturée.`);
        }

        console.log("Capture et mixage terminés.");
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
