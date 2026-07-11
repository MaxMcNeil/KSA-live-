const { execSync } = require('child_process');
const fs = require('fs');
const cheerio = require('cheerio');

async function capture() {
    const sources = [
        { url: 'https://www.spa.gov.sa/media?page=1&type=3', selector: 'img' },
        { url: 'https://www.akhbaar24.com/%D8%AD%D9%88%D8%A7%D8%AF%D8%AB', selector: 'img' }
    ];

    let images = [];
    
    for (const source of sources) {
        try {
            const html = execSync(`curl -sL "${source.url}"`).toString();
            const $ = cheerio.load(html);
            
            $(source.selector).each((i, el) => {
                const src = $(el).attr('src');
                // On filtre pour ne garder que les vraies URLs d'images
                if (src && src.startsWith('http')) images.push(src);
            });
        } catch (e) { console.log("Erreur lecture source :", e.message); }
    }

    const limit = Math.min(images.length, 20);
    console.log(`Nombre d'images trouvées : ${limit}`);
    
    for (let i = 0; i < limit; i++) {
        try {
            execSync(`curl -sL "${images[i]}" -o card_${i}.png`);
        } catch (e) { console.log(`Échec téléchargement image ${i}`); }
    }
}
capture();
