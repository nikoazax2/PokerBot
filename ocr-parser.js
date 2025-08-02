const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const Tesseract = require('tesseract.js');

// --- CONFIG (à ajuster pour ta résolution / layout) ---
const ROI_CONFIG = {
    hole_cards: [ // x, y, width, height
        { x: 1000, y: 800, w: 120, h: 170 }, // carte 1
        { x: 1125, y: 800, w: 120, h: 170 }, // carte 2
    ],
    community: [
        { x: 800, y: 500, w: 100, h: 140 }, // flop1
        { x: 910, y: 500, w: 100, h: 140 }, // flop2
        { x: 1020, y: 500, w: 100, h: 140 }, // flop3
        { x: 1130, y: 500, w: 100, h: 140 }, // turn
        { x: 1240, y: 500, w: 100, h: 140 }, // river
    ],
    pot: { x: 950, y: 420, w: 200, h: 100 },
    blinds: { x: 1050, y: 100, w: 150, h: 60 },
    stacks: [ // quelques stacks d'exemple
        { x: 850, y: 300, w: 120, h: 60 },
        { x: 950, y: 300, w: 120, h: 60 },
        { x: 1050, y: 300, w: 120, h: 60 },
        { x: 1150, y: 300, w: 120, h: 60 },
    ],
};

// Précharge les templates de cartes depuis templates/cards/ (Ah.png, Td.png, etc.)
async function loadCardTemplates() {
    const templates = {};
    const dir = path.join(__dirname, 'templates', 'cards');
    if (!fs.existsSync(dir)) throw new Error('Répertoire de templates de cartes manquant: templates/cards');

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'));
    for (const f of files) {
        const name = path.parse(f).name; // ex: Ah, Ks, Td
        const img = await Jimp.read(path.join(dir, f));
        templates[name] = img.clone().resize(100, 140); // normaliser taille
    }
    return templates;
}

// Compare un crop de carte avec tous les templates, retourne nom le plus proche si sous threshold.
async function matchCard(cardCropJimp, templates, threshold = 0.15) {
    // redimensionné pour matcher les templates (on suppose 100x140)
    const crop = cardCropJimp.clone().resize(100, 140).grayscale();
    let best = { name: null, diff: Infinity };
    for (const [name, tpl] of Object.entries(templates)) {
        const tplGray = tpl.clone().grayscale();
        const diff = Jimp.distance(crop, tplGray); // distance structurelle (0 = identique)
        const perc = Jimp.diff(crop, tplGray).percent; // différence par pixel
        // on peut combiner ou choisir l'un : ici on regarde percent
        if (perc < best.diff) {
            best = { name, diff: perc };
        }
    }
    if (best.diff <= threshold) {
        return best.name; // ex: 'Ah'
    }
    return null;
}

// Convertit nom de carte template ex 'Ah' -> format poker-evaluator ('Ah')
function cardNameToEvaluator(cardName) {
    if (!cardName) return null;
    let rank = cardName.slice(0, -1);
    let suit = cardName.slice(-1).toLowerCase();
    if (rank === '10') rank = 'T';
    const rankMap = { A: 'A', K: 'K', Q: 'Q', J: 'J', T: 'T' };
    if (rankMap[rank]) rank = rankMap[rank];
    // suits h,d,c,s déjà ok
    return `${rank}${suit}`;
}

// OCR d'une image Jimp en ne gardant que les chiffres (config PSM ligne)
async function ocrNumber(jimpImage) {
    const tmpPath = path.join(__dirname, `._tmp_${Date.now()}.png`);
    await jimpImage
        .clone()
        .grayscale()
        .contrast(0.5)
        .writeAsync(tmpPath);
    const {
        data: { text },
    } = await Tesseract.recognize(tmpPath, 'eng', {
        logger: () => { },
        tessedit_char_whitelist: '0123456789-',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });
    fs.unlinkSync(tmpPath);
    const cleaned = text.replace(/[^0-9\-]/g, '').trim();
    return cleaned;
}

// Parse le string de blinds "100-200" -> big blind comme minBet
function parseBlinds(str) {
    if (!str) return null;
    const m = str.match(/(\d+)[^\d]+(\d+)/);
    if (m) {
        const small = parseInt(m[1], 10);
        const big = parseInt(m[2], 10);
        return big;
    }
    const single = parseInt(str, 10);
    return isNaN(single) ? null : single;
}

// Fonction principale d'extraction (path screenshot)
async function extractStateFromScreenshot(screenshotPath, needHand = false) {
    const state = {
        hand: null,
        community: [],
        pot: null,
        minBet: null,
        numPlayers: null,
        bankroll: null,
        blinds: null,
    };

    if (!global._cardTemplates) {
        global._cardTemplates = await loadCardTemplates();
    }
    const templates = global._cardTemplates;

    const base = await Jimp.read(screenshotPath);

    // Hand
    if (needHand) {
        const handCards = [];
        for (const roi of ROI_CONFIG.hole_cards) {
            const crop = base.clone().crop(roi.x, roi.y, roi.w, roi.h);
            const matched = await matchCard(crop, templates);
            handCards.push(cardNameToEvaluator(matched) || null);
        }
        state.hand = handCards.filter(Boolean);
    }

    // Community
    for (const roi of ROI_CONFIG.community) {
        const crop = base.clone().crop(roi.x, roi.y, roi.w, roi.h);
        const matched = await matchCard(crop, templates);
        if (matched) {
            state.community.push(cardNameToEvaluator(matched));
        }
    }

    // Pot
    try {
        const potCrop = base.clone().crop(
            ROI_CONFIG.pot.x,
            ROI_CONFIG.pot.y,
            ROI_CONFIG.pot.w,
            ROI_CONFIG.pot.h
        );
        const potText = await ocrNumber(potCrop);
        state.pot = potText ? parseInt(potText.replace(/,/g, ''), 10) : null;
    } catch (e) {
        // silent fallback
    }

    // Blinds / minBet
    try {
        const blindCrop = base.clone().crop(
            ROI_CONFIG.blinds.x,
            ROI_CONFIG.blinds.y,
            ROI_CONFIG.blinds.w,
            ROI_CONFIG.blinds.h
        );
        const blindText = await Tesseract.recognize(await blindCrop.getBufferAsync(Jimp.MIME_PNG), 'eng', {
            logger: () => { },
            tessedit_char_whitelist: '0123456789-',
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        }).then(r => r.data.text);
        state.blinds = blindText.trim();
        state.minBet = parseBlinds(state.blinds);
    } catch (e) { }

    // Stacks (on compte combien de stacks valides pour estimer numPlayers)
    const stacks = [];
    for (const roi of ROI_CONFIG.stacks) {
        try {
            const crop = base.clone().crop(roi.x, roi.y, roi.w, roi.h);
            const txt = await ocrNumber(crop);
            const val = txt ? parseInt(txt.replace(/,/g, ''), 10) : null;
            stacks.push(val);
        } catch (e) {
            stacks.push(null);
        }
    }
    state.stacks = stacks;
    state.numPlayers = stacks.filter(v => v && v > 0).length || null;

    return state;
}

module.exports = {
    extractStateFromScreenshot,
};
