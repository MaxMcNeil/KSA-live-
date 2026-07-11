const https = require('https');
const fs = require('fs');
const cheerio = require('cheerio');

async function getHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', reject);
    });
}

async function capture() {
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4' }
    ];

    let images = [];
    for (const source of sources) {
        console.log("Lecture de :", source.url);
        const html = await getHtml(source.url);
        const $ = cheerio.load(html);
        $(source.selector).find('img').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http')) images.push(src);
        });
    }

    const limit = Math.min(images.length, 20);
    for (let i = 0; i < limit; i++) {
        await downloadImage(images[i], `card_${i}.png`);
        console.log(`Image ${i} enregistrée.`);
    }
}
capture();
