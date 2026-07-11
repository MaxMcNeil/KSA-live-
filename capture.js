const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    // Timeout global de 45 secondes pour tout le script
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    try {
        // On change le waitUntil pour ne plus attendre les pubs interminables
        await page.goto('https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        
        await page.waitForTimeout(5000); // Petite pause pour laisser les images charger
        
        const cards = await page.locator('.col-md-4, .news-card, article').all();
        console.log("Cartes trouvées:", cards.length);

        if (cards.length < 5) throw new Error(`Pas assez de cartes : ${cards.length}`);

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
