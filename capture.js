const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function downloadImage(url, filepath) {
    const response = await axios({ url, responseType: 'stream', timeout: 10000 });
    return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filepath))
            .on('finish', resolve)
            .on('error', reject);
    });
}

async function capture() {
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4' }
    ];

    let foundCards = [];

    for (const source of sources) {
        try {
            console.log("Lecture directe :", source.url);
            const { data } = await axios.get(source.url, { timeout: 15000 });
            const $ = cheerio.load(data);
            
            $(source.selector).each((i, el) => {
                const img = $(el).find('img').attr('src');
                if (img) {
                    foundCards.push(img.startsWith('http') ? img : 'https://www.akhbaar24.com' + img);
                }
            });
        } catch (e) { console.error(`Erreur sur ${source.url} : ${e.message}`); }
    }

    const limit = Math.min(foundCards.length, 20);
    if (limit === 0) process.exit(1);

    for (let i = 0; i < limit; i++) {
        try {
            await downloadImage(foundCards[i], `card_${i}.png`);
            console.log(`Carte ${i} téléchargée.`);
        } catch (e) { console.warn(`Échec download image ${i}`); }
    }
}
capture();
