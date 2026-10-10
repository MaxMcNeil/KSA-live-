// analysis.js
// Generates the "analysis" text for each headline — FULLY LOCAL, NO API.
//
// PRIMARY MECHANISM: crawl the full article (every item already carries a
// link) and run a local extractive summarizer (TextRank, a graph-ranking
// algorithm — the same family as PageRank) over its real sentences. This
// produces a genuine summary of the actual article: real sentences, really
// picked from the real text, zero invention. No API key, no quota, no
// external AI service, no ToS-violating scraping of consumer web tools
// (which was considered and rejected — those aren't built for programmatic
// use, break on any UI change, and are a worse dependency than a proper API
// would have been, not a better one).
//
// Google Gemini was used here previously and was removed entirely: across
// several real runs it repeatedly hit dead model names (404), overloaded
// capacity (503), and daily quota exhaustion (429) — once even with a
// suggested retry delay of ~13.6 hours, which hung the whole GitHub Actions
// job until it was force-cancelled. None of that can happen with a local
// algorithm: there's nothing external to go down, rate-limit, or deprecate.
//
// FALLBACK: when an item has no link, the crawl fails (network error,
// paywall, blocked request), or the extracted article is too short to
// summarize meaningfully, a rule-based offline generator (entity + category
// detection) kicks in — same safety net as before, unchanged.

const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const HTTP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

const GCC_COUNTRIES = {
    'السعودية': ['السعودية', 'سعودي', 'سعودية', 'الرياض', 'جدة', 'مكة', 'المدينة المنورة', 'ولي العهد', 'آل سعود', 'بن سلمان', 'المملكة'],
    'الإمارات': ['الإمارات', 'أبوظبي', 'دبي', 'الشارقة'],
    'قطر': ['قطر', 'الدوحة'],
    'البحرين': ['البحرين', 'المنامة'],
    'الكويت': ['الكويت'],
    // bare "عمان" is intentionally excluded — unvocalized it's ambiguous with
    // Amman, Jordan's capital. "مسقط"/"سلطنة عمان" are unambiguous; the
    // diacritic form "عُمان" is handled separately (see detectEntities) since
    // normalizeArabic() strips the very diacritic that disambiguates it.
    'عُمان': ['مسقط', 'سلطنة عمان']
};

// Not GCC members, but the actors that show up constantly in Gulf-adjacent
// war/security/diplomatic coverage. Detecting these (instead of only the 6
// GCC countries) is what keeps the analysis from falling back to the generic
// "منطقة الخليج" on most war/conflict headlines.
const REGIONAL_ACTORS = {
    'اليمن': ['اليمن', 'اليمني'],
    'الحوثيون': ['الحوثي', 'الحوثيون', 'جماعة الحوثي', 'أنصار الله'],
    'إيران': ['إيران', 'إيراني', 'طهران', 'الحرس الثوري'],
    'إسرائيل': ['إسرائيل', 'إسرائيلي', 'تل أبيب'],
    'غزة': ['غزة', 'فلسطين', 'فلسطيني', 'رفح', 'القطاع'],
    'البحر الأحمر': ['البحر الأحمر', 'باب المندب', 'خليج عدن'],
    'الولايات المتحدة': ['الولايات المتحدة', 'أمريكا', 'أمريكي', 'واشنطن']
};

const ALL_ENTITIES = { ...GCC_COUNTRIES, ...REGIONAL_ACTORS };

// Of REGIONAL_ACTORS, "البحر الأحمر" (Red Sea) is a place, not a belligerent —
// it can be detected and named, but it never makes sense as one side of an
// "X vs Y" conflict sentence, so it's excluded from pairing specifically.
const PAIRABLE_ENTITIES = new Set(Object.keys(ALL_ENTITIES).filter(n => n !== 'البحر الأحمر'));

// Checked in this order — war/conflict is the most specific/severe bucket,
// so it wins over a plain "security" match when both fire on the same text.
const CATEGORY_ORDER = ['war', 'rights', 'security', 'diplomatic', 'economic', 'social'];

const CATEGORY_KEYWORDS = {
    war: ['حرب', 'نزاع مسلح', 'غزو', 'قصف', 'غارة', 'غارات', 'جبهة', 'هدنة', 'وقف إطلاق النار',
          'نزوح', 'لاجئين', 'القوات', 'الجيش', 'عسكري', 'عسكرية', 'صواريخ', 'صاروخ', 'مسيّرة',
          'مسيرة', 'درون', 'ميليشيا', 'تحالف عسكري', 'اجتياح', 'حصار', 'ضربة جوية', 'كتيبة'],
    rights: ['اعتقال', 'قمع', 'انتهاك', 'انتهاكات', 'تعذيب', 'إعدام', 'حرية', 'حقوق', 'سجن', 'محاكمة'],
    security: ['اشتباك', 'عنف', 'هجوم', 'مقتل', 'قتل', 'انفجار', 'تصعيد', 'اعتداء', 'جريمة', 'أمن'],
    diplomatic: ['أزمة دبلوماسية', 'توتر', 'عقوبات', 'رفض', 'خلاف', 'إدانة', 'سفير', 'قطيعة', 'مقاطعة'],
    economic: ['فساد', 'أزمة اقتصادية', 'اقتصاد', 'أسعار', 'استثمار', 'نفط', 'ديون', 'تضخم'],
    social: ['احتجاج', 'غضب', 'استياء', 'انتقاد', 'انتقادات', 'فضيحة', 'جدل', 'مظاهرة']
};

// single-entity templates: {e} is one name, or several joined with "و"
const TEMPLATES = {
    war: [
        e => `يندرج هذا التطور ضمن مشهد عسكري متوتر يطال ${e}، وسط تخوف من اتساع رقعة المواجهة.`,
        e => `يعكس هذا الخبر استمرار التصعيد الميداني المرتبط بـ${e}، في ظل غياب أفق واضح لوقف إطلاق النار.`,
        e => `تأتي هذه التطورات العسكرية المتعلقة بـ${e} ضمن سياق إقليمي مشتعل يستدعي متابعة لصيقة.`
    ],
    // used only when exactly two distinct actors are detected in a war-flagged headline
    warPair: [
        (e1, e2) => `يعكس هذا التطور تصعيدًا ميدانيًا بين ${e1} و${e2}، وسط مخاوف من اتساع دائرة المواجهة العسكرية.`,
        (e1, e2) => `تندرج هذه المواجهة بين ${e1} و${e2} ضمن سلسلة أحداث متلاحقة تهدد الاستقرار الإقليمي.`
    ],
    rights: [
        e => `يثير هذا التطور تساؤلات حول ملف الحريات وحقوق الإنسان في ${e}، وهو موضوع يحظى بمتابعة متزايدة من منظمات حقوقية دولية.`,
        e => `يأتي هذا الخبر ضمن سلسلة ملفات حقوقية حساسة مرتبطة بـ${e}، ويعزز الجدل القائم حول هذا الملف.`,
        e => `يسلط هذا الحدث الضوء مجددًا على سجل الحريات العامة في ${e} في المرحلة الراهنة.`
    ],
    security: [
        e => `يعكس هذا الحادث استمرار التوترات الأمنية في محيط ${e}، وقد تكون له تداعيات على الاستقرار الإقليمي.`,
        e => `تندرج هذه الواقعة ضمن سلسلة أحداث أمنية متلاحقة تشهدها ${e} مؤخرًا، وتستدعي متابعة تطوراتها عن كثب.`,
        e => `يثير هذا الحادث الأمني قلقًا متزايدًا بشأن مسار الأوضاع في ${e}.`
    ],
    diplomatic: [
        e => `يسلط هذا الخبر الضوء على توتر محتمل في الملفات الدبلوماسية المرتبطة بـ${e}، وسط ترقب لردود فعل إقليمية ودولية.`,
        e => `يعكس هذا التطور حساسية الملفات السياسية التي تخص ${e} في المرحلة الراهنة.`,
        e => `يفتح هذا الخبر الباب أمام تساؤلات حول مستقبل العلاقات الدبلوماسية المرتبطة بـ${e}.`
    ],
    economic: [
        e => `يطرح هذا الخبر تساؤلات حول المشهد الاقتصادي في ${e}، في وقت تتابع فيه الأسواق أي مستجدات بحذر.`,
        e => `يأتي هذا الخبر في سياق التطورات الاقتصادية المتلاحقة التي تشهدها ${e} مؤخرًا.`
    ],
    social: [
        e => `يعكس هذا الخبر حالة من الجدل والانقسام في الرأي العام بخصوص ${e}، وسط تفاعل واسع على وسائل التواصل.`,
        e => `أثار هذا الموضوع موجة من الانتقادات والتفاعل المجتمعي المرتبط بـ${e}.`
    ],
    general: [
        e => `يندرج هذا الخبر ضمن سياق أوسع من المستجدات المتلاحقة في ${e}، وتستحق تداعياته متابعة خلال الأيام المقبلة.`,
        e => `يمثل هذا التطور إضافة إلى ملف المستجدات الجارية في ${e}، في ظل اهتمام إقليمي متزايد بالملف.`
    ]
};

// intensity prefix scales with how many alarming keywords actually matched —
// real signal from the text, not an invented fact. Worded per category so a
// rights story doesn't get military "escalation" language and vice versa.
const INTENSITY_LABELS = {
    war:        [{ min: 4, label: 'تطور خطير: ' },  { min: 2, label: 'تصعيد لافت: ' },  { min: 0, label: '' }],
    security:   [{ min: 4, label: 'تطور خطير: ' },  { min: 2, label: 'تصعيد لافت: ' },  { min: 0, label: '' }],
    rights:     [{ min: 3, label: 'تطور مقلق: ' },  { min: 1, label: '' },              { min: 0, label: '' }],
    diplomatic: [{ min: 3, label: 'توتر متصاعد: ' }, { min: 1, label: '' },             { min: 0, label: '' }],
    economic:   [{ min: 2, label: 'تطور لافت: ' },  { min: 0, label: '' }],
    social:     [{ min: 2, label: 'تطور لافت: ' },  { min: 0, label: '' }],
    general:    [{ min: 0, label: '' }]
};

// Arabic text in the wild sometimes carries diacritics (tashkeel) — e.g.
// "عُمان" (Oman, with a damma) vs the plain "عمان" in our keyword lists.
// Strip them before matching so both forms are recognized the same way.
function normalizeArabic(text) {
    return (text || '').replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, '');
}

function detectEntities(rawText, normalizedText) {
    const found = [];
    // diacritic-sensitive Oman check first — normalizeArabic() strips the
    // very mark ("عُمان") that disambiguates it from Amman, Jordan
    if ((rawText || '').includes('عُمان')) found.push('عُمان');
    for (const [name, terms] of Object.entries(ALL_ENTITIES)) {
        if (found.includes(name)) continue;
        if (terms.some(k => normalizedText.includes(k))) found.push(name);
        if (found.length >= 2) break;
    }
    return found.slice(0, 2);
}

function detectCategory(normalizedText) {
    for (const cat of CATEGORY_ORDER) {
        if (CATEGORY_KEYWORDS[cat].some(k => normalizedText.includes(k))) return cat;
    }
    return 'general';
}

function totalKeywordHits(normalizedText) {
    let hits = 0;
    for (const cat of CATEGORY_ORDER) {
        hits += CATEGORY_KEYWORDS[cat].filter(k => normalizedText.includes(k)).length;
    }
    return hits;
}

// deterministic pick from a hash of the text, so the same headline always
// gets the same line (no API = no randomness needed, just variety across items)
function pick(arr, seedStr) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
}

function intensityPrefixFor(category, hits) {
    const scale = INTENSITY_LABELS[category] || INTENSITY_LABELS.general;
    return scale.find(p => hits >= p.min).label;
}

// Used when no Gulf country or regional actor was detected at all — sources
// like AlMarsd carry general Arab-world/international news too (an Egyptian
// court case, a US story), and the old fallback claimed "this relates to
// Gulf developments" for those regardless, which was simply false — exactly
// what the "sans rapport" screenshots showed.
const NO_ENTITY_TEMPLATES = [
    () => 'لا يحمل هذا الخبر ارتباطًا مباشرًا وواضحًا بالشأن الخليجي، ويندرج ضمن المتابعة العامة لأبرز الأحداث المتداولة حاليًا.',
    () => 'يأتي هذا الخبر ضمن التغطية العامة للأحداث المتداولة، دون ارتباط إقليمي خليجي مباشر في مضمونه.'
];

function buildAnalysis(text) {
    const normalized = normalizeArabic(text);
    const entities = detectEntities(text, normalized);
    const category = detectCategory(normalized);
    const hits = totalKeywordHits(normalized);
    const prefix = intensityPrefixFor(category, hits);

    if (entities.length === 0) {
        return prefix + pick(NO_ENTITY_TEMPLATES, text || 'x')();
    }

    // conflict between two named (non-geographic) actors gets "X vs Y" phrasing
    const pairableEntities = entities.filter(e => PAIRABLE_ENTITIES.has(e));
    if (category === 'war' && pairableEntities.length === 2) {
        const line = pick(TEMPLATES.warPair, text || '')(pairableEntities[0], pairableEntities[1]);
        return prefix + line;
    }

    const entityPhrase = entities.join(' و');
    const pool = TEMPLATES[category] || TEMPLATES.general;
    const line = pick(pool, text || '')(entityPhrase);
    return prefix + line;
}

function offlineBatch(texts) {
    return texts.map(t => buildAnalysis(t));
}

// ---------- full-article crawl ----------
// A bot-challenge/CAPTCHA page (Cloudflare, etc.) still returns HTTP 200
// with real-looking HTML — a real run hit exactly this: the war-room panel
// once displayed "...but your activity and behavior on this site made us
// think that you are a bot..." as if it were the article's own analysis.
// Readability happily "extracts" that challenge page's text since it reads
// as plausible prose, so this has to be caught explicitly before trusting it.
const BOT_CHALLENGE_MARKERS = [
    'you are a bot', 'verify you are human', 'checking your browser',
    'enable javascript and cookies', 'cloudflare', 'captcha', 'access denied',
    'rate limit', 'unusual traffic', 'automated access', 'ddos protection',
    'يرجى تفعيل جافا سكريبت', 'تحقق من أنك لست روبوت'
];
function looksLikeBotChallenge(text) {
    const t = (text || '').toLowerCase();
    return BOT_CHALLENGE_MARKERS.some(marker => t.includes(marker));
}

// Returns { text, reason } instead of just text-or-null — "no errors in the
// log" previously meant nothing, because every failure was swallowed
// silently. reason lets getBatchAnalysis log an actual breakdown of WHY
// items fell back, instead of guessing blind across several runs.
// Turns raw HTML into { text, reason } via Readability — shared by both
// crawl methods below so the extraction/validation logic lives in one place.
function extractFromHtml(html, url) {
    if (typeof html !== 'string') return { text: null, reason: 'non-text-response' };
    if (looksLikeBotChallenge(html)) return { text: null, reason: 'bot-challenge-page' };

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.textContent) return { text: null, reason: 'readability-failed' };

    const text = article.textContent.trim();
    if (looksLikeBotChallenge(text)) return { text: null, reason: 'bot-challenge-text' };
    if (text.length <= 200) return { text: null, reason: 'article-too-short' };
    return { text, reason: 'ok' };
}

// PRIMARY: a real (headless) browser page — runs the site's JS, so
// JS-rendered articles actually render, and it looks like a real visitor
// rather than a bare HTTP client, which is what a plain axios GET cannot do.
// A real run showed exactly these two failure modes with axios: a site that
// renders its article body client-side (axios only ever sees the empty
// shell) and a site that blocks non-browser requests outright.
async function fetchArticleTextViaBrowser(url, context) {
    let page = null;
    try {
        page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(700); // let quick client-side rendering settle
        const html = await page.content();
        return extractFromHtml(html, url);
    } catch (e) {
        return { text: null, reason: e.message ? e.message.split('\n')[0].slice(0, 60) : 'browser-error' };
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

// FALLBACK: plain HTTP GET — used only when no browser context is available
// (e.g. browser launch failed). Lighter, but can't execute JS and is more
// easily blocked — exactly the gap the browser method above closes.
async function fetchArticleTextViaAxios(url) {
    try {
        const res = await axios.get(url, {
            headers: HTTP_HEADERS,
            timeout: 15000,
            maxContentLength: 5 * 1024 * 1024,
            validateStatus: s => s >= 200 && s < 400
        });
        return extractFromHtml(res.data, url);
    } catch (e) {
        const status = e.response ? e.response.status : null;
        const reason = status ? `http-${status}` : (e.code || e.message || 'network-error');
        return { text: null, reason };
    }
}

async function fetchArticleText(url, context) {
    if (!url) return { text: null, reason: 'no-url' };
    return context ? fetchArticleTextViaBrowser(url, context) : fetchArticleTextViaAxios(url);
}

// ---------- TextRank: local extractive summarization, zero AI/API ----------
// Names of every outlet this project scrapes/crawls directly.
const SOURCE_NAME_BLOCKLIST = [
    'المرصد', 'أخبار24', 'أخبار 24', 'واس', 'وكالة الأنباء السعودية',
    'الجزيرة نت', 'القدس العربي', 'بي بي سي', 'BBC', 'سكاي نيوز', 'Sky News',
    'ميدل إيست آي', 'Middle East Eye', 'SPA'
];

// A real run leaked "Axios" — a THIRD-PARTY outlet cited *inside* a crawled
// article ("وبحسب موقع أكسيوس الأمريكي...": Al Jazeera citing Axios), not
// one of our own 8 sources. A fixed name list can never be exhaustive — any
// article can cite Reuters, CNN, Politico, etc. — so this catches the
// STRUCTURE of outlet attribution instead (works whether the outlet is named
// in Arabic transliteration or Latin script, since the pattern is the
// surrounding Arabic phrase, not the name itself).
//
// A blanket "any Latin letters = reject" rule was tried here first and
// measured on a real run: it rejected 27/95 candidate sentences (28%) for
// containing an unrelated English word or acronym (dates, %, "GCC", etc.) —
// real collateral damage for no measurable gain over the patterns below,
// so it's gone. Keep this filter scoped to actual attribution structure.
const ATTRIBUTION_PATTERNS = [
    /(ذكرت|ذكر|أفادت|أفاد|كشفت|كشف|أعلنت|أعلن|وثقت|وثق|نشرت|نشر|نقلت|نقل)\s*(صحيفة|موقع|قناة|وكالة|شبكة|مجلة)/,
    /(صحيفة|موقع|قناة|وكالة أنباء|شبكة|مجلة)\s+\S+\s*(الأمريكي|الأمريكية|البريطاني|البريطانية|الإخباري|الإخبارية)/,
    /نقلا?ً?\s*عن\s*(صحيفة|موقع|قناة|وكالة|شبكة)/
];

function mentionsSource(sentence) {
    if (SOURCE_NAME_BLOCKLIST.some(name => sentence.includes(name))) return true;
    if (ATTRIBUTION_PATTERNS.some(re => re.test(sentence))) return true;
    return false;
}

function splitSentences(text) {
    return (text || '')
        .split(/(?<=[.!؟\n])\s+/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length > 15 && s.length < 400 && !mentionsSource(s));
}

function wordSetOf(sentence) {
    return new Set(
        normalizeArabic(sentence)
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1)
    );
}

function sentenceSimilarity(a, b) {
    if (a.size === 0 || b.size === 0) return 0;
    let overlap = 0;
    for (const w of a) if (b.has(w)) overlap++;
    const denom = Math.log(a.size + 1) + Math.log(b.size + 1);
    return denom > 0 ? overlap / denom : 0;
}

function textRankSummary(fullText, maxSentences = 3) {
    const sentences = splitSentences(fullText);
    if (sentences.length === 0) return '';
    if (sentences.length <= maxSentences) return sentences.join(' ');

    const wordSets = sentences.map(wordSetOf);
    const n = sentences.length;
    const sim = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const s = sentenceSimilarity(wordSets[i], wordSets[j]);
            sim[i][j] = s; sim[j][i] = s;
        }
    }
    const rowSums = sim.map(row => row.reduce((a, b) => a + b, 0));

    let scores = new Array(n).fill(1 / n);
    const damping = 0.85;
    for (let iter = 0; iter < 30; iter++) {
        const next = new Array(n).fill((1 - damping) / n);
        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let j = 0; j < n; j++) {
                if (i === j || rowSums[j] === 0) continue;
                sum += (sim[j][i] / rowSums[j]) * scores[j];
            }
            next[i] += damping * sum;
        }
        scores = next;
    }

    const top = scores
        .map((score, idx) => ({ idx, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .sort((a, b) => a.idx - b.idx); // restore original article order for coherence

    let result = top.map(r => sentences[r.idx]).join(' ');
    if (result.length > 420) result = result.slice(0, 420).trim() + '…';
    return result;
}

// Video-embed pages ("بالفيديو: ...") often have almost no body text beyond
// the caption, so textRankSummary's short-article path can return something
// that's just the headline again — a real run showed this exact duplicate.
// Word-overlap (Jaccard) rather than exact-match, so near-identical phrasing
// is caught too, not just byte-for-byte repeats.
function isNearDuplicate(a, b) {
    const wa = wordSetOf(a), wb = wordSetOf(b);
    if (wa.size === 0 || wb.size === 0) return false;
    let overlap = 0;
    for (const w of wa) if (wb.has(w)) overlap++;
    const union = wa.size + wb.size - overlap;
    return union > 0 && (overlap / union) > 0.6;
}

// An analysis opening with the same words as the title reads as "just
// repeating the headline", even when the rest of it genuinely differs
// (so the overall-overlap check above wouldn't catch it). Checked
// separately on purpose: first N words only, not the whole sentence.
function startsTheSame(analysis, title, wordCount = 5) {
    const normWords = (s) => normalizeArabic(s || '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const aWords = normWords(analysis).slice(0, wordCount);
    const tWords = normWords(title).slice(0, wordCount);
    if (aWords.length < 3 || tWords.length < 3) return false;
    let matches = 0;
    const len = Math.min(aWords.length, tWords.length);
    for (let i = 0; i < len; i++) if (aWords[i] === tWords[i]) matches++;
    return (matches / len) >= 0.6;
}

function mapWithConcurrency(items, limit, fn) {
    return new Promise((resolve) => {
        const results = new Array(items.length);
        let idx = 0;
        let active = 0;
        let done = 0;
        if (items.length === 0) return resolve(results);

        function next() {
            while (active < limit && idx < items.length) {
                const current = idx++;
                active++;
                Promise.resolve(fn(items[current], current))
                    .then(r => { results[current] = r; })
                    .catch(() => { results[current] = null; })
                    .finally(() => {
                        active--; done++;
                        if (done === items.length) resolve(results);
                        else next();
                    });
            }
        }
        next();
    });
}

/**
 * @param {Array<{text: string, link?: string}>} items
 * @param {import('playwright').Browser} [browser] - when provided, articles
 *        are crawled with a real browser page (executes JS, looks like a
 *        real visitor) instead of a bare HTTP GET. Pass capture.js's own
 *        already-open browser here — no extra launch needed.
 * @returns {Promise<string[]>} one analysis string per item, same order
 */
async function getBatchAnalysis(items, browser) {
    if (!items || items.length === 0) return [];

    // tiny backward-compat shim: a plain string[] still works (no crawl,
    // straight to the offline generator) in case anything still calls it that way
    const normalized = items.map(it => (typeof it === 'string') ? { text: it, link: null } : it);

    const tally = {}; // reason -> count, for the summary line below
    const bump = (reason) => { tally[reason] = (tally[reason] || 0) + 1; };

    let context = null;
    if (browser) {
        try {
            context = await browser.newContext({
                userAgent: HTTP_HEADERS['User-Agent'],
                viewport: { width: 1366, height: 768 },
                locale: 'ar-SA',
                timezoneId: 'Asia/Riyadh'
            });
            // navigator.webdriver === true is the single most common
            // headless-browser tell basic-to-intermediate anti-bot checks
            // look for — Playwright sets it by default. Hiding it is a
            // standard, widely-documented mitigation, not a fragile hack.
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
            // we only need text — blocking the heavy stuff speeds up every
            // page load noticeably and cuts down on timeouts. Stylesheets
            // and scripts stay on: some sites hide content via CSS/JS until
            // hydration, and Readability needs the final rendered DOM.
            await context.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (type === 'image' || type === 'media' || type === 'font') {
                    route.abort().catch(() => {});
                } else {
                    route.continue().catch(() => {});
                }
            });
        } catch (e) {
            console.warn(`  ⚠ could not open browser context (${e.message}) — crawling via plain HTTP instead`);
            context = null;
        }
    }
    // browser pages are heavier than bare HTTP requests — keep concurrency
    // modest so this doesn't overload the runner
    const concurrency = context ? 3 : 5;

    try {
        const results = await mapWithConcurrency(normalized, concurrency, async (item) => {
            if (!item.link) {
                bump('no-link');
                return buildAnalysis(item.text);
            }

            const { text: articleText, reason } = await fetchArticleText(item.link, context);
            if (!articleText) {
                bump(reason);
                return buildAnalysis(item.text);
            }

            const summary = textRankSummary(articleText, 3);
            if (!summary || summary.length <= 40) {
                bump('summary-too-short');
                return buildAnalysis(item.text);
            }
            if (isNearDuplicate(summary, item.text)) {
                bump('near-duplicate-of-title');
                return buildAnalysis(item.text);
            }
            if (startsTheSame(summary, item.text)) {
                bump('starts-same-as-title');
                return buildAnalysis(item.text);
            }

            bump('ok-real-summary');
            return summary;
        });

        const total = normalized.length;
        const ok = tally['ok-real-summary'] || 0;
        const breakdown = Object.entries(tally)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, n]) => `${reason}=${n}`)
            .join(', ');
        console.log(`  📊 analysis source: ${ok}/${total} real article summaries (via ${context ? 'browser' : 'http'}), rest fell back (${breakdown})`);

        return results;
    } finally {
        if (context) await context.close().catch(() => {});
    }
}

// Synchronous, no network — lets capture.js/fetch-news.js tag each item with
// a category (war/rights/security/diplomatic/economic/social/general) for
// the UI's category icon, reusing the same detection used for the fallback.
function getCategoryFor(text) {
    return detectCategory(normalizeArabic(text));
}

module.exports = { getBatchAnalysis, getCategoryFor };
