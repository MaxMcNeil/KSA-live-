const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 700 } });
    const tmpDir = './tmp_cards';
    
    try {
        await page.goto('https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', { waitUntil: 'networkidle' });
        
        // Attente réelle du rendu
        await page.evaluate(() => Promise.all([...document.images].map(img => 
            img.complete ? null : new Promise(r => img.onload = r)
        )));
        await page.waitForTimeout(3000);
        
        const cards = await page.locator('.col-md-4, .news-card, article').all();
        console.log("Cartes trouvées:", cards.length);

        if (cards.length < 5) throw new Error(`Pas assez de cartes trouvées : ${cards.length}`);

        // Nettoyage et préparation du répertoire temporaire
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        // Capture des 5 premières
        for (let i = 0; i < 5; i++) {
            await cards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
        }
        
        // Validation stricte
        for (let i = 0; i < 5; i++) {
            if (!fs.existsSync(path.join(tmpDir, `card_${i}.png`))) {
                throw new Error(`Erreur vérification : card_${i}.png manquant`);
            }
        }
        
        // Déploiement vers la racine
        for (let i = 0; i < 5; i++) {
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        console.log("Capture validée et déployée.");
    } catch (e) {
        console.error("Erreur critique :", e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
