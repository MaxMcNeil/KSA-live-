const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function capture() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 600, height: 700 } });
    const page = await context.newPage();
    const tmpDir = './tmp_cards';
    
    // Sources ordonnées par priorité
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card, .card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4, .news-card, article' }
    ];

    let allCards = [];

    try {
        // Tenter de récupérer le contenu des sources disponibles
        for (const source of sources) {
            try {
                console.log("Tentative de chargement :", source.url);
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(4000);
                
                const found = await page.locator(source.selector).all();
                if (found.length > 0) {
                    allCards.push(...found);
                    console.log(`Succès : ${found.length} cartes récupérées.`);
                }
            } catch (err) {
                console.warn(`Avertissement : échec sur ${source.url}, passage à la suite. (${err.message})`);
            }
        }

        // Sécurité critique : S'il n'y a vraiment aucune carte nulle part
        if (allCards.length === 0) {
            throw new Error("Toutes les sources ont échoué, impossible de capturer de nouvelles données.");
        }

        // On prend jusqu'à 10 cartes maximum
        const limit = Math.min(allCards.length, 10);

        // Gestion du dossier temporaire
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir);
        
        // Capture effective
        for (let i = 0; i < limit; i++) {
            await allCards[i].screenshot({ path: path.join(tmpDir, `card_${i}.png`) });
        }
        
        // Validation d'intégrité des fichiers générés
        for (let i = 0; i < limit; i++) {
            if (!fs.existsSync(path.join(tmpDir, `card_${i}.png`))) {
                throw new Error(`Fichier card_${i}.png manquant après capture.`);
            }
        }
        
        // Déploiement propre vers la racine
        for (let i = 0; i < limit; i++) {
            fs.copyFileSync(path.join(tmpDir, `card_${i}.png`), `card_${i}.png`);
        }
        
        // Si on a moins de 10 cartes, on nettoie les anciennes excédentaires pour éviter d'afficher des fantômes
        for (let i = limit; i < 10; i++) {
            if (fs.existsSync(`card_${i}.png`)) {
                fs.unlinkSync(`card_${i}.png`);
            }
        }

        console.log(`Déploiement réussi : ${limit} cartes actives.`);
    } catch (e) {
        console.error("Erreur critique de la régie, maintien de l'existant :", e.message);
        // On ne fait pas un process.exit(1) si on veut que le site continue d'afficher les anciennes images s'il y a un pépin mineur, 
        // mais pour forcer l'alerte GitHub Action, on sort en erreur.
        process.exit(1);
    } finally {
        await browser.close();
    }
}
capture();
