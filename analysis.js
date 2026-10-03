// analysis.js
// Generates a short Arabic "analysis/context" line for each headline.
//
// PRIMARY: Google Gemini (free tier, Google AI Studio — no credit card).
// Real per-article understanding instead of templated boilerplate.
//
// FALLBACK: a fully offline, zero-dependency rule-based generator (entity +
// category detection), used automatically whenever Gemini is unavailable —
// no key set, quota hit, network error, or a malformed/unexpected response
// (Google's own developer forum has recent reports, Aug–Sep 2026, of
// intermittent 404s on Flash-model aliases, so this WILL happen sometimes).
// The live never breaks either way — worst case, quality quietly degrades
// to templated for that batch until Gemini is reachable again.
//
// The offline generator, stated plainly: it's rule-based (entity + category
// detection picking from a template pool), not real analysis — generic/
// framing-only (no invented facts) so it's always safe to show, but it's a
// safety net, not the intended everyday experience. To make it feel sharper
// anyway, it:
//   - recognizes not just the 6 Gulf countries but the regional actors that
//     actually drive most Gulf-adjacent war/security coverage (Yemen, the
//     Houthis, Iran, Israel, Gaza, the Red Sea, the US)
//   - builds "X vs Y" phrasing when two actors are both mentioned (common in
//     conflict stories), instead of a flat single-entity line
//   - scales the sentence's intensity wording to how many alarming keywords
//     were actually found, instead of a flat tone for everything

const axios = require('axios');

// Google's model naming has been a moving target throughout 2026
// (gemini-2.0-flash shut down 2026-06-01 → 404; gemini-flash-latest → 503
// under free-tier load; gemini-2.5-flash → 404 again for this key/region).
// Rather than guess one name at a time across multiple slow workflow runs,
// try an ordered list and remember whichever one actually works.
// Override with a repo variable/secret named GEMINI_MODEL to force one name.
const GEMINI_MODEL_CANDIDATES = process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-001', 'gemini-2.5-flash-lite', 'gemini-pro-latest'];

// Cached for the lifetime of this process (one capture.js or fetch-news.js
// run) so once a working model is found, every subsequent batch in the same
// run uses it directly instead of re-probing dead candidates each time.
let workingModel = null;

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

function buildAnalysis(text) {
    const normalized = normalizeArabic(text);
    const entities = detectEntities(text, normalized);
    const category = detectCategory(normalized);
    const hits = totalKeywordHits(normalized);
    const prefix = intensityPrefixFor(category, hits);

    // conflict between two named (non-geographic) actors gets "X vs Y" phrasing
    const pairableEntities = entities.filter(e => PAIRABLE_ENTITIES.has(e));
    if (category === 'war' && pairableEntities.length === 2) {
        const line = pick(TEMPLATES.warPair, text || '')(pairableEntities[0], pairableEntities[1]);
        return prefix + line;
    }

    const entityPhrase = entities.length > 0 ? entities.join(' و') : 'منطقة الخليج';
    const pool = TEMPLATES[category] || TEMPLATES.general;
    const line = pick(pool, text || '')(entityPhrase);
    return prefix + line;
}

function offlineBatch(texts) {
    return texts.map(t => buildAnalysis(t));
}

let warnedMissingKey = false;

// One batched Gemini call for a whole list of headlines (not one call per
// item) — keeps call volume tiny and comfortably inside any free-tier quota.
// Returns null (never throws) on any problem, so the caller can fall back.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 503 ("model overloaded") and 429 (rate limit) are the Gemini free tier's
// most common failure modes, and both are usually transient — a short retry
// clears most of them instead of giving up on real analysis immediately.
const RETRYABLE_STATUSES = new Set([503, 429, 500, 502, 504]);
const RETRY_DELAYS_MS = [2000, 5000];

async function callGeminiOnce(texts, apiKey, prompt, model) {
    const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: Math.min(4000, 200 * texts.length + 300) }
        },
        {
            headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
            timeout: 30000
        }
    );

    const parts = res.data && res.data.candidates && res.data.candidates[0] &&
                  res.data.candidates[0].content && res.data.candidates[0].content.parts;
    const raw = (parts || []).map(p => p.text || '').join('').trim();
    const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length === texts.length && arr.every(a => typeof a === 'string' && a.trim())) {
        return arr.map(a => a.trim());
    }
    throw new Error('shape-mismatch'); // treated as non-retryable below
}

// Tries one model, with retries for transient errors (503/429/5xx) on that
// model specifically. Returns { ok: true, result } / { ok: false, status }
// so the caller can decide whether to move on to the next candidate model.
async function tryModel(texts, apiKey, prompt, model) {
    const attempts = RETRY_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await callGeminiOnce(texts, apiKey, prompt, model);
            return { ok: true, result };
        } catch (e) {
            const status = e.response ? e.response.status : null;
            const isLast = attempt === attempts - 1;
            const retryable = status && RETRYABLE_STATUSES.has(status);

            if (retryable && !isLast) {
                const delay = RETRY_DELAYS_MS[attempt];
                console.warn(`  ⚠ Gemini (${model}) فشل (HTTP ${status}) — إعادة المحاولة خلال ${delay / 1000} ثوانٍ...`);
                await sleep(delay);
                continue;
            }

            if (e.message === 'shape-mismatch') {
                console.warn(`  ⚠ Gemini (${model}): شكل استجابة غير متطابق`);
            } else {
                console.warn(`  ⚠ Gemini (${model}) فشل${status ? ` (HTTP ${status})` : ''}: ${e.message}`);
            }
            return { ok: false, status };
        }
    }
    return { ok: false, status: null };
}

async function tryGemini(texts) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        if (!warnedMissingKey) {
            console.warn('  ⚠ GEMINI_API_KEY غير مُعرَّف — سيتم استخدام نظام القوالب المحلي بدل تحليل حقيقي. ' +
                'أضف السر (secret) في إعدادات GitHub للحصول على تحليل فعلي لكل خبر.');
            warnedMissingKey = true;
        }
        return null;
    }

    const numbered = texts.map((t, i) => `${i + 1}. ${String(t || '').slice(0, 260)}`).join('\n');
    const prompt =
        'أنت محرر أخبار متخصص في شؤون السعودية والخليج. لكل عنوان/مقتطف من العناصر المرقمة أدناه، ' +
        'اكتب سطرًا إلى سطرين (تحليل أو سياق) باللغة العربية الفصحى يضيفان معلومة فعلية — ' +
        'خلفية الحدث، سبب أهميته، أو تداعياته المحتملة — دون إعادة صياغة العنوان نفسه ودون حشو، ' +
        'وبالاعتماد حصرًا على معلومات واردة في النص (لا تخترع أسماء أو أرقامًا أو تواريخ).\n' +
        `أجب حصرًا بمصفوفة JSON تحتوي على ${texts.length} نصًا بنفس الترتيب، بدون أي شرح أو Markdown أو نص خارج المصفوفة.\n\n${numbered}`;

    // a model already confirmed working earlier in this run — use it directly
    if (workingModel) {
        const r = await tryModel(texts, apiKey, prompt, workingModel);
        if (r.ok) return r.result;
        workingModel = null; // it stopped working mid-run — fall through and re-probe
    }

    for (const model of GEMINI_MODEL_CANDIDATES) {
        const r = await tryModel(texts, apiKey, prompt, model);
        if (r.ok) {
            workingModel = model;
            console.log(`  ✓ Gemini: يعمل عبر النموذج "${model}"`);
            return r.result;
        }
        // 404 means this model name doesn't exist/isn't accessible — skip
        // straight to the next candidate instead of wasting more calls on it
    }

    console.warn('  ⚠ Gemini: فشلت كل النماذج المرشحة — التراجع إلى النظام المحلي لهذه الدفعة');
    return null;
}

/**
 * @param {string[]} texts - headlines/excerpts (Arabic)
 * @returns {Promise<string[]>} same length as texts — kept async so call
 *          sites (capture.js / fetch-news.js) don't need to change.
 */
async function getBatchAnalysis(texts) {
    if (!texts || texts.length === 0) return [];

    const fromGemini = await tryGemini(texts);
    if (fromGemini) return fromGemini;

    return offlineBatch(texts);
}

module.exports = { getBatchAnalysis };
