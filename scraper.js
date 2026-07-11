const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrape() {
    try {
        const { data } = await axios.get('https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB');
        const $ = cheerio.load(data);
        let news = [];

        // Sélecteur mis à jour pour Akhbaar24
        $('.col-md-4.col-sm-6').each((i, el) => {
            const title = $(el).find('h3').text().trim();
            const image = $(el).find('img').attr('src');
            if (title) {
                news.push({ title, image });
            }
        });
        
        fs.writeFileSync('news.json', JSON.stringify(news.slice(0, 10)));
    } catch (e) { console.error("Erreur de scraping :", e); }
}
scrape();
