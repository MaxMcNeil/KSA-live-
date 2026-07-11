const { chromium } = require('playwright');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
    
    // Configuration des sources à scraper
    const sources = [
        { name: 'SPA', url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { name: 'Akhbaar24', url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card' }
    ];

    let globalCount = 0;

    for (const source of sources) {
        console.log(`Navigation vers ${source.name}...`);
        await page.goto(source.url, { waitUntil: 'domcontentloaded' });
        
        // Diagnostic : on compte les éléments pour cette source
        const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, source.selector);
        console.log(`Nombre d'éléments trouvés pour ${source.name} (${source.selector}) : ${count}`);

        const items = await page.evaluate((sel) => {
            const data = [];
            document.querySelectorAll(sel).forEach(el => {
                // On essaie plusieurs sélecteurs pour le titre et l'image
                const title = el.innerText; // Récupère tout le texte du bloc
                const img = el.querySelector('img')?.src;
                if (title && img) data.push({ title, img });
            });
            return data.slice(0, 3); // 3 par site pour équilibrer
        }, source.selector);

        // Génération des images
        for (let i = 0; i < items.length; i++) {
            const html = `
                <div style="width:600px; height:800px; background:white; padding:40px; font-family:sans-serif; text-align:center;">
                    <img src="${items[i].img}" style="width:100%; height:400px; object-fit:cover; border-radius:20px;">
                    <h2 style="color:#333; margin-top:20px; font-size: 20px;">${items[i].title}</h2>
                </div>`;
            await page.setContent(html);
            await page.screenshot({ path: `card_${globalCount}.png` });
            console.log(`Généré : card_${globalCount}.png`);
            globalCount++;
        }
    }
    await browser.close();
}
capture();
