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
const { getBatchAnalysis, getCategoryFor } = require('./analysis');

const parser = new Parser({ timeout: 15000 });
const HTTP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

// Native-Arabic and English RSS feeds, parsed generically with rss-parser.
const RSS_FEEDS = [
    { url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9', name: 'الجزيرة نت', lang: 'ar' },
    { url: 'https://www.alquds.co.uk/feed/', name: 'القدس العربي', lang: 'ar' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', lang: 'en' },
    { url: 'https://feeds.bbci.co.uk/arabic/rss.xml', name: 'BBC Arabic', lang: 'ar' },
    // Reported intermittently unreachable by third-party feed-health monitors
    // as of early Oct 2026 — left in since a failed feed is already handled
    // gracefully (logged and skipped, doesn't block the others).
    { url: 'https://www.skynewsarabia.com/web/rss', name: 'Sky News Arabia', lang: 'ar' },
];

// Middle East Eye has no working RSS feed anymore, so its per-country listing
// pages are scraped directly instead. Every one of these pages is already
// scoped to a Gulf country, so no keyword filter is needed for them.
const MEE_COUNTRY_PAGES = [
    { url: 'https://www.middleeasteye.net/countries/bahrain', country: 'البحرين' },
    { url: 'https://www.middleeasteye.net/countries/qatar', country: 'قطر' },
    { url: 'https://www.middleeasteye.net/countries/saudi-arabia', country: 'السعودية' },
    { url: 'https://www.middleeasteye.net/countries/uae', country: 'الإمارات' },
    { url: 'https://www.middleeasteye.net/countries/oman', country: 'عُمان' },
    { url: 'https://www.middleeasteye.net/countries/kuwait', country: 'الكويت' },
];

const GULF_KEYWORDS_AR = [
    'السعودية', 'سعودي', 'سعودية', 'الرياض', 'جدة', 'مكة', 'المدينة المنورة',
    'ولي العهد', 'آل سعود', 'بن سلمان', 'المملكة',
    'الإمارات', 'أبوظبي', 'دبي', 'الشارقة',
    'قطر', 'الدوحة', 'البحرين', 'المنامة',
    // bare "عمان" intentionally excluded — unvocalized it's ambiguous with
    // Amman, Jordan's capital. "عُمان" (with the disambiguating diacritic),
    // "مسقط" and "سلطنة عمان" are unambiguous.
    'الكويت', 'عُمان', 'مسقط', 'سلطنة عمان',
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

// Same story can surface with a query string, trailing slash, or via several
// country pages (a Gulf-wide story is often tagged to more than one country
// on MEE) — normalize before dedup-checking so we never show it twice.
function normalizeLink(link) {
    if (!link) return '';
    try {
        const u = new URL(link);
        u.search = '';
        u.hash = '';
        let path = u.pathname.replace(/\/+$/, '');
        return (u.host + path).toLowerCase();
    } catch (e) {
        return String(link).split('?')[0].replace(/\/+$/, '').toLowerCase();
    }
}

async function scrapeMeeCountryPage(page) {
    const items = [];
    try {
        const res = await axios.get(page.url, { headers: HTTP_HEADERS, timeout: 15000 });
        const $ = cheerio.load(res.data);

        // MEE (Drupal) wraps every teaser headline in an <h2>/<h3> that links
        // to the article — that reliably separates real headlines from the
        // nav links and the small topic-tag links sitting next to them.
        $('h2 a[href], h3 a[href]').each((i, el) => {
            const hrefRaw = $(el).attr('href') || '';
            const title = $(el).text().replace(/\s+/g, ' ').trim();
            if (!title || title.length < 20) return;
            if (/\/(topics|countries)\//.test(hrefRaw)) return;

            let link;
            try { link = new URL(hrefRaw, page.url).href; } catch (e) { return; }
            if (!/\/(news|opinion|reportage|discover|live)\//.test(new URL(link).pathname)) return;

            items.push({ title, link });
        });
    } catch (e) {
        console.warn(`⚠️  MEE page failed: ${page.country} (${page.url}) — ${e.message}`);
    }
    return items.slice(0, 15);
}

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
    const seenLinks = new Set(); // global dedup across every source

    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            let kept = 0;
            for (const item of (parsed.items || []).slice(0, 40)) {
                const rawTitle = (item.title || '').trim();
                if (!rawTitle) continue;
                const rawDesc = stripHtml(item.contentSnippet || item.content || item.summary || '');
                const combined = `${rawTitle} ${rawDesc}`;

                if (!matchesGulf(combined, feed.lang)) continue;

                const normalized = normalizeLink(item.link);
                if (normalized && seenLinks.has(normalized)) continue;
                if (normalized) seenLinks.add(normalized);

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

    for (const page of MEE_COUNTRY_PAGES) {
        const items = await scrapeMeeCountryPage(page);
        let kept = 0;
        for (const it of items) {
            const normalized = normalizeLink(it.link);
            if (normalized && seenLinks.has(normalized)) continue; // already have this story
            if (normalized) seenLinks.add(normalized);

            collected.push({
                title: it.title,
                link: it.link,
                source: 'Middle East Eye',
                lang: 'en',
                pubDate: '',
                score: negativityScore(it.title, 'en')
            });
            kept++;
        }
        console.log(`✓ Middle East Eye (${page.country}): ${kept} item(s) kept`);
    }

    // most controversial/negative first, then most recent (undated items sort last)
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
        finalItems.forEach(it => { it.category = getCategoryFor(it.title); });

        console.log(`✍ generating analysis for ${finalItems.length} war-room item(s) (full-article crawl + local summary)...`);
        const analyses = await getBatchAnalysis(finalItems.map(it => ({ text: it.title, link: it.link })));
        finalItems.forEach((it, i) => { it.analysis = analyses[i]; });

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
