const { execSync } = require('child_process');
const fs = require('fs');
const cheerio = require('cheerio');

async function capture() {
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: '.media-card' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: '.col-md-4' }
    ];

    let images = [];
    
    for (const source of sources) {
        try {
            // Téléchargement du HTML via curl
            const html = execSync(`curl -sL "${source.url}"`).toString();
            const $ = cheerio.load(html);
            
            $(source.selector).find('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.startsWith('http')) images.push(src);
            });
        } catch (e) { console.error("Erreur lecture :", e.message); }
    }

    const limit = Math.min(images.length, 20);
    for (let i = 0; i < limit; i++) {
        try {
            // Téléchargement de l'image via curl
            execSync(`curl -sL "${images[i]}" -o card_${i}.png`);
            console.log(`Image ${i} enregistrée.`);
        } catch (e) { console.error(`Erreur image ${i}`); }
    }
}
capture();
