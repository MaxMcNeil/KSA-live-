const https = require('https');
const fs = require('fs');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

// Fonction pour récupérer le HTML sans utiliser fetch/axios
function getHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
    
    // Scraping des données avec Cheerio (via https natif)
    const spaHtml = await getHtml('https://www.spa.gov.sa/media?page=1&type=3');
    const $ = cheerio.load(spaHtml);
    
    let articles = [];
    $('.media-card').each((i, el) => {
        if (articles.length < 5) {
            articles.push({
                title: $(el).find('h2').text().trim(),
                img: $(el).find('img').attr('src')
            });
        }
    });

    // Génération des images
    for (let i = 0; i < articles.length; i++) {
        const html = `
            <div style="width:600px; height:800px; background:white; padding:40px; font-family:sans-serif; text-align:center;">
                <img src="${articles[i].img}" style="width:100%; height:500px; object-fit:cover; border-radius:20px;">
                <h1 style="color:#333; margin-top:20px;">${articles[i].title}</h1>
            </div>`;
        await page.setContent(html);
        await page.screenshot({ path: `card_${i}.png` });
    }
    await browser.close();
}
capture();
