// fetch-news.js
// Pulls headlines from a handful of RSS feeds, keeps only items that concern
// Saudi Arabia / the Gulf, prioritizes the more controversial/negative-sounding
// ones, and writes everything out in Arabic to news.json for the "war room"
// breaking-news panel on the live page.
//
// Design notes:
//  - Arabic-native feeds are used as-is (no translation risk).
//  - English feeds are filtered FIRST (so we only ever translate a handful of
//    already-relevant items), then machine-translated. If a translation call
//    fails or looks broken, that single item is silently dropped rather than
//    ever showing non-Arabic text on air.
//  - If everything fails, we simply leave the previous news.json untouched
//    (see the workflow: news.json is never wiped ahead of time) so the panel
//    always has *something* to show rather than going blank.

const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');

const parser = new Parser({ timeout: 15000 });

const FEEDS = [
    { url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9', name: 'الجزيرة نت', lang: 'ar' },
    { url: 'https://www.alquds.co.uk/feed/', name: 'القدس العربي', lang: 'ar' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', lang: 'en' },
    { url: 'https://www.middleeasteye.net/rss', name: 'Middle East Eye', lang: 'en' },
];

const GULF_KEYWORDS_AR = [
    'السعودية', 'سعودي', 'سعودية', 'الرياض', 'جدة', 'مكة', 'المدينة المنورة',
    'ولي العهد', 'آل سعود', 'بن سلمان', 'المملكة',
    'الإمارات', 'أبوظبي', 'دبي', 'الشارقة',
    'قطر', 'الدوحة', 'البحرين', 'المنامة',
    'الكويت', 'عمان', 'مسقط', 'سلطنة عمان',
    'الخليج', 'دول الخليج', 'مجلس التعاون الخليجي'
];
const GULF_KEYWORDS_EN = [
    'saudi', 'riyadh', 'jeddah', 'mecca', 'medina', 'mbs', 'crown prince',
    'uae', 'emirates', 'abu dhabi', 'dubai', 'sharjah',
    'qatar', 'doha', 'bahrain', 'manama',
    'kuwait', 'oman', 'muscat',
    'gulf', 'gcc'
];

const NEGATIVE_KEYWORDS_AR = [
    'اعتقال', 'قمع', 'انتقاد', 'انتقادات', 'فضيحة', 'احتجاج', 'انتهاك', 'انتهاكات',
    'مقتل', 'قتل', 'إعدام', 'تعذيب', 'فساد', 'أزمة', 'توتر', 'رفض', 'غضب',
    'خلاف', 'عقوبات', 'تصعيد', 'انفجار', 'هجوم', 'خرق', 'تجاوز', 'إدانة',
    'تحقيق', 'فشل', 'خطر', 'تهديد', 'عنف', 'اشتباك', 'نزاع', 'استياء', 'أزمة دبلوماسية'
];
const NEGATIVE_KEYWORDS_EN = [
    'arrest', 'crackdown', 'criticism', 'criticised', 'criticized', 'scandal',
    'protest', 'violation', 'killed', 'death', 'execution', 'torture',
    'corruption', 'crisis', 'tension', 'reject', 'anger', 'dispute',
    'sanction', 'escalation', 'explosion', 'attack', 'abuse', 'condemn',
    'investigation', 'fail', 'threat', 'violence', 'clash', 'conflict', 'outrage'
];

function stripHtml(raw) {
    if (!raw) return '';
    try {
        return cheerio.load(`<div>${raw}</div>`)('div').text().replace(/\s+/g, ' ').trim();
    } catch (e) {
        return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

function matchesGulf(text, lang) {
    const t = text.toLowerCase();
    const list = lang === 'ar' ? GULF_KEYWORDS_AR : GULF_KEYWORDS_EN;
    return list.some(k => t.includes(k.toLowerCase()));
}

function negativityScore(text, lang) {
    const t = text.toLowerCase();
    const list = lang === 'ar' ? NEGATIVE_KEYWORDS_AR : NEGATIVE_KEYWORDS_EN;
    return list.reduce((acc, k) => acc + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function translateToArabic(text) {
    try {
        const res = await axios.get('https://api.mymemory.translated.net/get', {
            params: { q: text.slice(0, 480), langpair: 'en|ar' },
            timeout: 10000
        });
        const translated = res.data && res.data.responseData && res.data.responseData.translatedText;
        if (translated && translated.trim() && !/MYMEMORY WARNING/i.test(translated)) {
            return translated.trim();
        }
    } catch (e) {
        console.warn(`  ⚠️  translation failed: ${e.message}`);
    }
    return null; // caller drops the item — never show non-Arabic text on air
}

async function main() {
    const collected = [];

    for (const feed of FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            let kept = 0;
            for (const item of (parsed.items || []).slice(0, 40)) {
                const rawTitle = (item.title || '').trim();
                if (!rawTitle) continue;
                const rawDesc = stripHtml(item.contentSnippet || item.content || item.summary || '');
                const combined = `${rawTitle} ${rawDesc}`;

                if (!matchesGulf(combined, feed.lang)) continue;

                collected.push({
                    title: rawTitle,
                    link: item.link || '',
                    source: feed.name,
                    lang: feed.lang,
                    pubDate: item.pubDate || item.isoDate || '',
                    score: negativityScore(combined, feed.lang)
                });
                kept++;
            }
            console.log(`✓ ${feed.name}: ${kept} Gulf/KSA item(s) matched`);
        } catch (e) {
            console.warn(`⚠️  Feed failed: ${feed.name} (${feed.url}) — ${e.message}`);
        }
    }

    // most controversial/negative first, then most recent
    collected.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
    });

    const top = collected.slice(0, 24);
    const finalItems = [];

    for (const it of top) {
        if (it.lang === 'ar') {
            finalItems.push({ title: it.title, source: it.source, link: it.link, negative: it.score > 0 });
        } else {
            const translated = await translateToArabic(it.title);
            if (translated) {
                finalItems.push({ title: translated, source: it.source, link: it.link, negative: it.score > 0 });
            }
            await sleep(400); // be polite to the free translation endpoint
        }
    }

    if (finalItems.length > 0) {
        fs.writeFileSync('news.json', JSON.stringify(finalItems));
        console.log(`\n✅ news.json written with ${finalItems.length} Gulf/KSA item(s)`);
    } else {
        console.log('\n⚠️  No matching items this run — leaving previous news.json (if any) untouched');
    }
}

main().catch(e => {
    console.error('fetch-news.js failed:', e.message);
    process.exit(0); // never fail the whole workflow just because news fetching had a bad day
});
