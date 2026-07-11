const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function downloadImage(url, filename) {
    const writer = fs.createWriteStream(filename);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function capture() {
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4' }
    ];

    let imageUrls = [];

    for (const source of sources) {
        try {
            console.log("Lecture de :", source.url);
            const { data } = await axios.get(source.url);
            const $ = cheerio.load(data);
            
            $(source.selector).find('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.startsWith('http')) imageUrls.push(src);
            });
        } catch (e) { console.error("Erreur lecture :", e.message); }
    }

    // On ne garde que les 20 premières images
    const filesToKeep = imageUrls.slice(0, 20);
    
    for (let i = 0; i < filesToKeep.length; i++) {
        try {
            await downloadImage(filesToKeep[i], `card_${i}.png`);
            console.log(`Image ${i} enregistrée.`);
        } catch (e) { console.error(`Erreur image ${i}`); }
    }
}
capture();
