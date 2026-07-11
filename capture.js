const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
    console.log("--- DÉBUT DE LA CAPTURE ---");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.news-card' }
    ];

    let count = 0;
    for (const s of sources) {
        try {
            await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            const elements = await page.locator(s.selector).all();
            for (const el of elements.slice(0, 10)) {
                await el.screenshot({ path: `card_${count}.png` });
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
