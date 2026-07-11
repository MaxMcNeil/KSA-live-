const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrape() {
    let allNews = [];

    // 1. Scraping SPA (La structure est souvent très standard chez eux)
    try {
        const { data } = await axios.get('https://www.spa.gov.sa/media?page=1&type=3');
        const $ = cheerio.load(data);
        // On cible les conteneurs qui ont un titre et une image
        $('.media-card').each((i, el) => {
            const title = $(el).find('h2, .title').text().trim();
            const image = $(el).find('img').attr('src');
            if (title && image) {
                allNews.push({ title, image, source: 'SPA' });
            }
        });
    } catch (e) { console.error("Erreur scraping SPA :", e); }

    // 2. Scraping Akhbaar24
    try {
        const { data } = await axios.get('https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB');
        const $ = cheerio.load(data);
        $('.col-md-4.col-sm-6').each((i, el) => {
            const title = $(el).find('h3').text().trim();
            const image = $(el).find('img').attr('src');
            if (title && image) {
                allNews.push({ title, image, source: 'Akhbaar24' });
            }
        });
    } catch (e) { console.error("Erreur scraping Akhbaar24 :", e); }
    
    // On limite à 20 pour correspondre exactement à ta limite de capture
    fs.writeFileSync('news.json', JSON.stringify(allNews.slice(0, 20)));
    console.log(`Scraping terminé. Total articles sauvegardés: ${Math.min(allNews.length, 20)}`);
}
scrape();
