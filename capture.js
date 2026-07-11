const { chromium } = require('playwright');

async function main() {
    console.log("--- DEBUT DU SCRIPT ---");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

    // Configuration des deux sources
    const sources = [
        { name: 'SPA', url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card', prefix: 'spa' },
        { name: 'Akhbaar24', url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card', prefix: 'akh' }
    ];

    for (const source of sources) {
        try {
            console.log(`Navigation vers ${source.name}...`);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Attendre que les éléments apparaissent
            await page.waitForSelector(source.selector, { timeout: 10000 }).catch(() => {});
            
            const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, source.selector);
            console.log(`Elements trouvés pour ${source.name} (${source.selector}) : ${count}`);

            // On capture les 3 premiers éléments de chaque source
            const elements = await page.locator(source.selector).all();
            for (let i = 0; i < Math.min(elements.length, 3); i++) {
                const path = `${source.prefix}_card_${i}.png`;
                await elements[i].screenshot({ path: path });
                console.log(`Généré : ${path}`);
            }
        } catch (e) {
            console.error(`Erreur sur ${source.name} :`, e.message);
        }
    }

    await browser.close();
    console.log("--- FIN DU SCRIPT ---");
}
main();
