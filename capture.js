const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE ---");
    // Ajout de --no-sandbox
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card' }
    ];

    let count = 0;
    for (const s of sources) {
        try {
            console.log(`Navigation vers ${s.url}`);
            await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
            const elements = await page.locator(s.selector).all();
            
            for (let i = 0; i < Math.min(elements.length, 10); i++) {
                await elements[i].screenshot({ path: `card_${count}.png` });
                console.log(`Capture ${count} générée.`);
                count++;
            }
        } catch (e) {
            console.error(`Erreur source ${s.url}:`, e.message);
        }
    }
    fs.writeFileSync('total.json', JSON.stringify({ count }));
    await browser.close();
    console.log(`--- FIN : ${count} cartes générées ---`);
}
main();
