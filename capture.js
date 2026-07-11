const { chromium } = require('playwright');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
    
    // On navigue sur le site
    await page.goto('https://www.spa.gov.sa/media?page=1&type=3', { waitUntil: 'domcontentloaded' });
    
    // On extrait les données directement depuis le navigateur
    const articles = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('.media-card').forEach(el => {
            const title = el.querySelector('h2')?.innerText || el.querySelector('.title')?.innerText;
            const img = el.querySelector('img')?.src;
            if (title && img) items.push({ title, img });
        });
        return items.slice(0, 5);
    });

    console.log(`Articles trouvés : ${articles.length}`);

    // Génération des images
    for (let i = 0; i < articles.length; i++) {
        const html = `
            <div style="width:600px; height:800px; background:white; padding:40px; font-family:sans-serif; text-align:center;">
                <img src="${articles[i].img}" style="width:100%; height:500px; object-fit:cover; border-radius:20px;">
                <h1 style="color:#333; margin-top:20px; font-size: 24px;">${articles[i].title}</h1>
            </div>`;
        await page.setContent(html);
        await page.screenshot({ path: `card_${i}.png` });
    }
    await browser.close();
}
capture();
