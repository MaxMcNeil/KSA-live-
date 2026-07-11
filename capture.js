const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const { chromium } = require('playwright');

async function capture() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
    let articles = [];

    // 1. Scraping (SPA)
    try {
        const { data } = await axios.get('https://www.spa.gov.sa/media?page=1&type=3');
        const $ = cheerio.load(data);
        $('.media-card').each((i, el) => {
            if (articles.length < 10) articles.push({ title: $(el).find('h2').text().trim(), img: $(el).find('img').attr('src') });
        });
    } catch (e) {}

    // 2. Génération des images
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
