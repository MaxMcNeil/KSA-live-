const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrape() {
    let news = [];

    // 1. Scraping Akhbaar24
    try {
        const { data } = await axios.get('https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB');
        const $ = cheerio.load(data);
        $('.col-md-4.col-sm-6').each((i, el) => {
            const title = $(el).find('h3').text().trim();
            const image = $(el).find('img').attr('src');
            if (title) news.push({ title, image, source: 'Akhbaar24' });
        });
    } catch (e) { console.error("Erreur Akhbaar24 :", e); }

    // 2. Scraping SPA
    try {
        const { data } = await axios.get('https://www.spa.gov.sa/media?page=1&type=3');
        const $ = cheerio.load(data);
        // Note: Les sélecteurs dépendent de la structure HTML réelle de SPA
        $('.media-card').each((i, el) => {
            const title = $(el).find('h2').text().trim(); // À ajuster selon le HTML réel de SPA
            const image = $(el).find('img').attr('src');
            if (title) news.push({ title, image, source: 'SPA' });
        });
    } catch (e) { console.error("Erreur SPA :", e); }

    // Sauvegarde du résultat global
    fs.writeFileSync('news.json', JSON.stringify(news.slice(0, 10)));
    console.log(`Scraping terminé. Total articles: ${news.length}`);
}
scrape();
        
