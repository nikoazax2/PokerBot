// === Dépendances ===
const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const screenshot = require('./screenshot-util');
const { createWorker } = require('tesseract.js');
const nodeTesseract = require('node-tesseract-ocr');
const { exec } = require('child_process');
const sharp = require('sharp');

// === S'assurer que Tesseract natif est dans le PATH ===
const tessDir = "C:\\Program Files\\Tesseract-OCR";
if (!process.env.PATH.toLowerCase().includes(tessDir.toLowerCase())) {
  process.env.PATH = `${tessDir};${process.env.PATH}`;
}

// === Configuration du bot ===
const aggressiveness = 1; // 0.5 prudent, 1 normal, >1 agressif
const bluffingEnabled = true;
const bluffFrequency = 0.2; // 20%

// === Constantes OCR / parsing ===
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const BLINDS_REGEX = /(\d{1,4})\s*[-–]\s*(\d{1,4})/;
const NUMBER_REGEX = /(\d{2,6})/g;
const DEFAULT_COMMUNITY_SUITS = ['h', 'c', 'd', 's', 'h']; // cycle pour heuristique

// === Helpers OCR ===
async function recognizeText(imagePath) {
  const nativeConfig = {
    lang: 'eng',
    oem: 1,
    psm: 6,
    tessedit_char_whitelist: 'AKQJT98765432HDCS0123456789-:.'
  };

  const hasNative = await new Promise(res => {
    exec('tesseract --version', err => res(!err));
  });

  if (hasNative) {
    try {
      return await nodeTesseract.recognize(imagePath, nativeConfig);
    } catch (e) {
      console.warn('OCR natif a échoué, fallback vers tesseract.js:', e.message);
    }
  }

  const worker = createWorker({ logger: () => {} });
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  await worker.setParameters({
    tessedit_char_whitelist: 'AKQJT98765432HDCS0123456789-:.',
    tessedit_pageseg_mode: '6',
  });
  const { data: { text } } = await worker.recognize(imagePath);
  await worker.terminate();
  return text;
}

async function preprocess(imagePath) {
  const buf = await sharp(imagePath)
    .grayscale()
    .normalize()
    .threshold(150)
    .toBuffer();
  const tmp = path.join(path.dirname(imagePath), `preproc_${path.basename(imagePath)}`);
  await fs.promises.writeFile(tmp, buf);
  return tmp;
}

function extractRankTokens(raw) {
  let s = raw.toUpperCase();
  s = s.replace(/I0/g, '10').replace(/1O/g, '10'); // confusions
  s = s.replace(/[^A-Z0-9\s]/g, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  return tokens.map(t => {
    if (t === 'T') return '10';
    if (RANKS.includes(t)) return t;
    return null;
  }).filter(Boolean);
}

function ensureFullHandInteractive(hand) {
  return hand.map(card => {
    if (!/[HDCS]$/i.test(card)) {
      let full;
      while (true) {
        full = readlineSync.question(`La carte "${card}" manque de couleur. Donne-la complète (ex: Ah, Ks): `).trim().toUpperCase();
        if (/^[AKQJT98765432]{1,2}[HDCS]$/i.test(full)) break;
        console.log('Format invalide, réessaie.');
      }
      return full;
    }
    return card.toUpperCase();
  });
}

// Construire community avec suits par défaut, puis proposer override
function completeCommunityWithSuits(ranks) {
  const defaultCards = ranks.map((r, i) => {
    const suit = DEFAULT_COMMUNITY_SUITS[i % DEFAULT_COMMUNITY_SUITS.length];
    return `${r}${suit}`; // ex: 'Kh'
  });
  console.log(`Flop/Board détecté (rangs) : ${ranks.join(' ')}`);
  const override = readlineSync.question(`Si tu veux préciser les suits du board, entre 5 cartes (ex: Kh 5c 2c Jd Ts), sinon appuie sur Entrée pour utiliser [${defaultCards.join(' ')}]: `).trim();
  if (override) {
    const parts = override.split(/\s+/).filter(p => p.length >= 2);
    if (parts.length >= 3) {
      // on prend jusqu'à 5
      return parts.slice(0, 5).map(p => p.toUpperCase());
    }
  }
  return defaultCards.slice(0, Math.min(5, ranks.length));
}

// === Parsing OCR simplifié ===
async function OCRInput(screenshotPath, streetName = '', needHand = false) {
  let hand = [];
  let community = [];
  let pot = 0;
  let minBet = 0;
  let numPlayers = 2;
  let bankroll = 0;

  // prétraitement (silencieux en cas d'échec)
  let pathForOCR = screenshotPath;
  try {
    pathForOCR = await preprocess(screenshotPath);
  } catch (_) { }

  const rawText = await recognizeText(pathForOCR);
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  console.log(`--- OCR brut (${streetName}) ---\n${rawText}\n-----------------------------`);

  // minBet : check ou blinds
  if (/\bCHECK\b/i.test(rawText) || /\bC\b/.test(rawText)) {
    minBet = 0;
  } else {
    const blindMatch = rawText.match(BLINDS_REGEX);
    if (blindMatch) {
      minBet = parseInt(blindMatch[2], 10); // big blind
    }
  }

  // extraire tous les nombres valides
  const numberCandidates = Array.from(new Set(
    (rawText.match(/[\d\.\,]{2,7}/g) || [])
      .map(tok => tok.replace(/[^\d]/g, ''))
      .filter(n => n.length)
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n))
  )).sort((a, b) => a - b);

  // bankroll : plus grand
  if (numberCandidates.length) {
    bankroll = numberCandidates[numberCandidates.length - 1];
  }

  // pot : plus grand < bankroll sinon médian
  if (numberCandidates.length) {
    const below = numberCandidates.filter(n => n < bankroll);
    if (below.length) pot = below[below.length - 1];
    else pot = numberCandidates[Math.floor(numberCandidates.length / 2)];
  }

  // main : recherche de deux ranks consécutifs dans une ligne
  if (needHand) {
    let found = false;
    for (const line of lines) {
      const match = line.match(/\b(A|K|Q|J|10|9|8|7|6|5|4|3|2)\s+(A|K|Q|J|10|9|8|7|6|5|4|3|2)\b/i);
      if (match) {
        hand = [match[1].toUpperCase(), match[2].toUpperCase()];
        found = true;
        break;
      }
    }
    if (!found) {
      const rankTokens = extractRankTokens(rawText);
      if (rankTokens.length >= 2) {
        hand = [rankTokens[0], rankTokens[1]];
      }
    }
    if (hand.length === 2) {
    //   hand = ensureFullHandInteractive(hand); // demander suits si manquants
    }
  }

  // community (board)
  const rankTokens = extractRankTokens(rawText);
  const filtered = hand.map(h => h.replace(/[HDCS]$/i, '')).filter(Boolean);
  const boardRanks = rankTokens.filter(r => !filtered.includes(r));
  // enlever doublons en préservant ordre
  const uniq = [];
  for (const r of boardRanks) {
    if (!uniq.includes(r)) uniq.push(r);
  }
  const top5 = uniq.slice(0, 5); // ex: ['K','5','2','J','10']
  community = completeCommunityWithSuits(top5); // ajoute suits ou demande override

  // numPlayers heuristique : stacks distincts + toi
  const stackCandidates = numberCandidates.filter(n => n > 100 && n !== bankroll && n !== pot);
  const uniqStacks = [...new Set(stackCandidates)];
  numPlayers = Math.max(2, uniqStacks.length + 1);

  return {
    hand,
    community,
    pot,
    minBet,
    numPlayers,
    bankroll,
    rawText,
    lines,
  };
}

// === Évaluation et décision ===
function evaluateOdds(hand, community, numPlayers) {
  if (!Array.isArray(hand) || hand.length !== 2) return 0;
  if (!Array.isArray(community)) community = [];
  return PokerEvaluator
    .winningOddsForPlayer(hand, community, numPlayers, 2000)
    .winRate;
}

function makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness = 1) {
  hand = hand || [];
  community = community || [];
  bankroll = bankroll || 0;
  pot = pot || 0;
  minBet = minBet || 0;
  numPlayers = numPlayers || 2;

  console.log(`Main: ${hand.join(', ')}, Board: ${community.join(' ')}, Pot: ${pot}, MinBet: ${minBet}, Bankroll: ${bankroll}, Joueurs: ${numPlayers}`);
  const winRate = evaluateOdds(hand, community, numPlayers);
  const pct = (winRate * 100).toFixed(1);
  console.log(`Probabilité de gagner : ${pct}%`);

  let action = '';
  let amount = 0;
  const isPreflop = (community == null || community.length === 0);

  if (isPreflop) {
    const foldThreshold = 0.18;
    const callThreshold = 0.40;
    const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);

    if (winRate < foldThreshold) {
      action = 'Fold';
      console.log('Décision pré-flop : Fold');
    } else if (winRate < callThreshold) {
      action = 'Call';
      amount = minBet;
      console.log(`Décision pré-flop : Call ${amount}`);
    } else {
      action = 'Raise';
      let maxRaise = Math.min(Math.floor(pot * 0.5), Math.floor(bankroll * 0.3));
      let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
      factor = Math.max(0, Math.min(1, factor));
      amount = Math.floor(minBet + factor * (maxRaise - minBet));
      if (amount < minBet) amount = minBet;
      console.log(`Décision pré-flop : Raise à ${amount}`);
    }
    return { action, amount };
  }

  // après le flop
  const foldThreshold = 0.18;
  const callThreshold = 0.40;
  const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);
  let effectiveBluffFreq = bluffFrequency;
  if (numPlayers > 2) effectiveBluffFreq *= 0.5;

  if (winRate < foldThreshold && minBet > 0) {
    if (bluffingEnabled && Math.random() < effectiveBluffFreq) {
      action = 'Bluff Raise';
      amount = Math.floor(pot * 0.5);
      if (amount > bankroll * 0.5) amount = Math.floor(bankroll * 0.5);
      console.log(`Bluff : Raise à ${amount}`);
    } else {
      action = 'Fold';
      console.log('Décision : Fold');
    }
    return { action, amount };
  }

  if (winRate < callThreshold) {
    if (bluffingEnabled && minBet === 0 && Math.random() < effectiveBluffFreq) {
      action = 'Bluff Bet';
      amount = Math.floor(Math.min(pot * 0.5, bankroll * 0.3));
      console.log(`Bluff d'initiative à ${amount}`);
    } else if (minBet <= pot * 0.15 && minBet <= bankroll * 0.10) {
      action = 'Call';
      amount = minBet;
      console.log(`Call raisonnable à ${amount}`);
    } else {
      action = 'Fold';
      console.log('Fold : mise trop élevée');
    }
    return { action, amount };
  }

  // grosse main
  const minBetPct = bankroll > 0 ? minBet / bankroll : 1;
  if (winRate >= raiseThreshold) {
    if (minBetPct > 0.5) {
      action = 'Fold';
      console.log('Fold : mise trop élevée par rapport à la bankroll');
    } else if (minBetPct > 0.3) {
      action = 'Call';
      amount = minBet;
      console.log('Call : relance trop risquée');
    } else {
      action = 'Raise';
      let maxRaise = Math.min(Math.floor(pot * (0.8 * aggressiveness)), Math.floor(bankroll * (0.5 * aggressiveness)));
      let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
      factor = Math.max(0, Math.min(1, factor));
      amount = Math.floor(minBet + factor * (maxRaise - minBet));
      if (amount < minBet) amount = minBet;
      console.log(`Relance agressive à ${amount}`);
    }
    return { action, amount };
  }

  // dernier cas
  if (minBet <= bankroll * 0.20) {
    action = 'Call';
    amount = minBet;
    console.log(`Call final à ${amount}`);
  } else {
    action = 'Fold';
    console.log('Fold final');
  }
  return { action, amount };
}

// === Historique ===
const historyPath = path.join(__dirname, 'historique.json');
function loadHistory() {
  if (fs.existsSync(historyPath)) {
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}
function saveHistory(history) {
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
}
function createGameRow(uuid, now) {
  return {
    uuid,
    date: now.toLocaleDateString(),
    heure: now.toLocaleTimeString(),
    steps: []
  };
}
function addStepToHistory(uuid, stepData) {
  let history = loadHistory();
  const idx = history.findIndex(row => row.uuid === uuid);
  if (idx !== -1) {
    if (!Array.isArray(history[idx].steps)) history[idx].steps = [];
    history[idx].steps.push(stepData);
    saveHistory(history);
  }
}

// === Gestion par street ===
async function getStreetInput(streetName, needHand = false) {
  let hand = null, community = null, pot = null, minBet = null, numPlayers = null, bankroll = null;
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);
  const screenshotPath = path.join(screenshotsDir, `${streetName}_${Date.now()}.png`);

  try {
    await screenshot({ filename: screenshotPath, screenId: `\\\\.\\DISPLAY1` });
  } catch (err) {
    console.error('Erreur capture:', err);
  }

  const parsed = await OCRInput(screenshotPath, streetName, needHand);
  hand = parsed.hand;
  community = parsed.community;
  pot = parsed.pot;
  minBet = parsed.minBet;
  numPlayers = parsed.numPlayers;
  bankroll = parsed.bankroll;

  return { hand, community, pot, minBet, numPlayers, bankroll };
}

// === Boucle principale ===
async function pokerBot() {
  console.clear();
  const style = `${aggressiveness <= 0.5 ? 'Prudent' : aggressiveness <= 1 ? 'Normal' : 'Agressif'}${bluffingEnabled ? ' (Bluff actif)' : ''}`;
  console.log(`=== Poker Bot - Style: ${style} ===`);

  const uuid = randomUUID();
  const now = new Date();
  let hand, pot, minBet, numPlayers, decision, bankroll;
  let community = [];

  let history = loadHistory();
  history.push(createGameRow(uuid, now));
  saveHistory(history);

  async function playStreet(street, needHand = false) {
    const input = await getStreetInput(street, needHand);
    if (needHand) hand = input.hand;
    community = [...community, ...(input.community || [])];
    pot = input.pot;
    minBet = input.minBet;
    numPlayers = input.numPlayers;
    if (input.bankroll !== undefined) bankroll = input.bankroll;

    decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    addStepToHistory(uuid, {
      street,
      hand,
      community: [...community],
      pot,
      minBet,
      numPlayers,
      bankroll,
      decision
    });

    if (["flop", "turn", "river"].includes(street)) {
      const relance = readlineSync.question(`Quelqu'un a-t-il relancé au ${street} ? (o/n): `, { defaultInput: 'n' }).toLowerCase();
      if (relance === 'o') {
        const newMinBetInput = readlineSync.question('Nouvelle mise minimale à suivre / relancer: ');
        minBet = newMinBetInput.trim() === '' ? 0 : parseInt(newMinBetInput, 10);
        numPlayers = parseInt(readlineSync.question('Nombre de joueurs ayant suivi la relance (incl. vous): '), 10);
        decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
        addStepToHistory(uuid, {
          street: `${street}-relance`,
          hand,
          community: [...community],
          pot,
          minBet,
          numPlayers,
          bankroll,
          decision
        });
      }
    }
  }

  await playStreet('pre-flop', true);
  await playStreet('flop');
  await playStreet('turn');
  await playStreet('river');
}

// === Lancer ===
pokerBot();
