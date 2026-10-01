// analysis.js
// Generates a short Arabic "analysis/context" line for each headline —
// FULLY OFFLINE. No API key, no network call, no rate limit, no cost, no
// external dependency that could fail, get deprecated (as GitHub Models was,
// retired 2026-07-30) or disrupt the live.
//
// Trade-off, stated plainly: this is rule-based (entity + category detection
// picking from a template pool), not a real per-article LLM analysis. It's
// deliberately generic/framing-only (no invented facts) so it's always safe
// to show. To make it feel sharper despite being offline, it:
//   - recognizes not just the 6 Gulf countries but the regional actors that
//     actually drive most Gulf-adjacent war/security coverage (Yemen, the
//     Houthis, Iran, Israel, Gaza, the Red Sea, the US)
//   - builds "X vs Y" phrasing when two actors are both mentioned (common in
//     conflict stories), instead of a flat single-entity line
//   - scales the sentence's intensity wording to how many alarming keywords
//     were actually found, instead of a flat tone for everything

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

/**
 * @param {string[]} texts - headlines/excerpts (Arabic)
 * @returns {Promise<string[]>} same length as texts — kept async so call
 *          sites (capture.js / fetch-news.js) don't need to change.
 */
async function getBatchAnalysis(texts) {
    return (texts || []).map(t => buildAnalysis(t));
}

module.exports = { getBatchAnalysis };
