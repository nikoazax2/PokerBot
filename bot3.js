const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const aggressiveness = 1; // Niveau d'agressivité du bot (0.5 = prudent, 1 = normal, 1.5 = agressif)
const bluffingEnabled = true; // Activer/désactiver le comportement de bluff
const bluffFrequency = 0.1;   // Fréquence de bluff (ex. 0.2 = 20% de chances de bluffer aux situations opportunes)

// Conversion de la saisie en format poker-evaluator
function convertCard(card) {
    const c = card.toLowerCase();
    const m = c.match(/^(\d+)(co|ca|tr|pi)$/);
    if (!m) return card;
    const [, num, suit] = m;
    const rank = { '1': 'A', '10': 'T', '11': 'J', '12': 'Q', '13': 'K' }[num] || num;
    const suitLetter = { co: 'h', ca: 'd', tr: 'c', pi: 's' }[suit] || '';
    return rank + suitLetter;
}

// Lecture des inputs pour chaque street
function getStreetInput(streetName, needHand = false) {
    let hand, community, pot, minBet, numPlayers, bankroll;

    function parseAmount(input) {
        input = input.trim().toLowerCase();
        if (input.endsWith('k')) {
            return parseInt(input.replace('k', ''), 10) * 1000;
        }
        return parseInt(input, 10);
    }

    if (streetName == 'pre-flop') {
        bankroll = parseAmount(readlineSync.question('Votre bankroll actuelle: '));
    }

    if (needHand) {
        hand = readlineSync
            .question('Entrez votre main (2 cartes, ex. "13pi 2co"): ')
            .split(' ')
            .map(convertCard);
    }

    if (streetName !== 'pre-flop') {
        community = readlineSync
            .question(`Entrez les cartes du ${streetName} (séparées par un espace): `)
            .split(' ')
            .map(convertCard);
    }

    pot = parseAmount(readlineSync.question('Taille du pot actuel: '));
    numPlayers = parseInt(readlineSync.question('Nombre de joueurs dans le coup (incl. vous): '), 10);
    const minBetInput = readlineSync.question('Mise minimale à suivre / relancer (entrer pour 0): ');
    minBet = minBetInput.trim() === '' ? 0 : parseAmount(minBetInput);

    return { hand, community, pot, minBet, numPlayers, bankroll };
}

// Calcul de la probabilité de victoire
function evaluateOdds(hand, community, numPlayers) {
    return PokerEvaluator
        .winningOddsForPlayer(hand, community, numPlayers, 2000)
        .winRate;
}

// Prise de décision du bot et montant de relance
function makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness = 1) {
    console.log(`Calcul des chances de gagner pour la main: ${hand.join(', ')} et les cartes communes: ${community?.join(', ')} avec ${numPlayers} joueurs dans le coup. Mise minimale à suivre: ${minBet}, Pot: ${pot}, Bankroll: ${bankroll}.`);
    console.log('\n');

    const winRate = evaluateOdds(hand, community || [], numPlayers);
    const pct = (winRate * 100).toFixed(1);
    const bold = '\x1b[1m';
    const resetColor = '\x1b[0m';
    console.log(`${bold}Probabilité de gagner : ${pct}%${resetColor}`);

    let action = '';
    let amount = 0;
    const isPreflop = (community == null || community.length === 0);
    if (isPreflop) {
        // Afficher la probabilité de gagner au pré-flop et la différence par rapport à un tirage aléatoire
        const diff = (pct - 100 / numPlayers).toFixed(1);
        let diffColor;
        if (Math.abs(diff) <= 4) {
            diffColor = '\x1b[37m'; // blanc (différence neutre)
        } else if (diff > 0) {
            diffColor = '\x1b[32m'; // vert (meilleure que la moyenne)
        } else {
            diffColor = '\x1b[31m'; // rouge (pire que la moyenne)
        }
        console.log(`Probabilité de gagner théorique avec ${numPlayers} joueurs : ${(100 / numPlayers).toFixed(1)}% vs obtenue : ${pct}%`);
        console.log(`${bold}Différence : ${diffColor}${diff}%${resetColor}`);

        // Seuils préflop (identiques aux autres streets)
        const foldThreshold = 0.18;
        const callThreshold = 0.40;
        const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);

        let action = '';
        let amount = 0;
        if (winRate < foldThreshold) {
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision pré-flop : Se coucher (Fold)${resetColor}`);
            return { action, amount };
        } else if (winRate < callThreshold) {
            action = 'Suivre';
            amount = minBet;
            const white = '\x1b[37m';
            if (minBet === 0) {
                console.log(`${bold}${white}Décision pré-flop : Suivre (Check)${resetColor}`);
            } else {
                console.log(`${bold}Décision pré-flop : Suivre (Call) pour ${minBet}${resetColor}`);
            }
            return { action, amount };
        } else {
            // Relance agressive possible : calcul du montant optimal (max 50% du pot ou 30% de la bankroll)
            let maxRaisePot = Math.floor(pot * 0.5);
            let maxRaiseBankroll = Math.floor(bankroll * 0.3);
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
            let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Relancer';
            amount = raiseAmount;
            const green = '\x1b[32m';
            console.log(`${bold}${green}Décision pré-flop : Relancer à ${raiseAmount}${resetColor}`);
            return { action, amount };
        }
    }

    // Seuils de probabilité (configurables)
    const foldThreshold = 0.18; // < 18% : se coucher (fold)
    const callThreshold = 0.40; // 18-40% : suivre (call/check) si la mise est raisonnable
    // Ajuster le seuil de relance selon l'agressivité (plus agressif -> relance avec une proba plus faible)
    const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);

    // Ajuster la fréquence de bluff en fonction du nombre d'adversaires (bluffer moins si multiway)
    let effectiveBluffFreq = bluffFrequency;
    if (numPlayers > 2) {
        effectiveBluffFreq *= 0.5; // réduit de moitié la fréquence de bluff si plusieurs adversaires
    }

    // Décision de se coucher (Fold) avec possibilité de bluff à la place
    if (winRate < foldThreshold && minBet > 0) {
        if (bluffingEnabled && Math.random() < effectiveBluffFreq) {
            // Choisit de bluffer au lieu de folder
            action = 'Relancer';
            // Calcule un montant de bluff raisonnable (environ 50% du pot, au moins le double de la mise actuelle)
            let bluffAmount = Math.floor(pot * 0.5);
            if (bluffAmount < minBet * 2) {
                bluffAmount = minBet * 2;
            }
            // Ne pas dépasser 50% de la bankroll pour un bluff
            if (bluffAmount > bankroll * 0.5) {
                bluffAmount = Math.floor(bankroll * 0.5);
            }
            if (bluffAmount <= 0) bluffAmount = minBet || 1;
            amount = bluffAmount;
            const magenta = '\x1b[35m';
            console.log(`${bold}${magenta}Décision : Relancer en BLUFF à ${bluffAmount}${resetColor}`);
            return { action, amount };
        } else {
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
            return { action, amount };
        }
    }

    // Décision de suivre (Call/Check) avec possibilité de bluff d'initiative si aucune mise en face
    if (winRate < callThreshold) {
        // Si personne n'a misé et bluff activé, tenter parfois une mise bluff (donk bet) au lieu de checker
        if (bluffingEnabled && minBet === 0 && Math.random() < effectiveBluffFreq) {
            action = 'Relancer';
            // Petit bluff : environ 50% du pot (limité à ~30% de la bankroll pour limiter les risques)
            let bluffBet = Math.floor(pot * 0.5);
            if (bluffBet > bankroll * 0.3) {
                bluffBet = Math.floor(bankroll * 0.3);
            }
            if (bluffBet < 1) bluffBet = 1;
            amount = bluffBet;
            const magenta = '\x1b[35m';
            console.log(`${bold}${magenta}Décision : Miser ${amount} en bluff${resetColor}`);
            return { action, amount };
        }

        console.log(`-> Suivre (Call) si mise raisonnable: ${minBet} <= ${pot * 0.15} et ${minBet} <= ${bankroll * 0.10}`);

        if (minBet <= pot * 0.15 && minBet <= bankroll * 0.10) {
            action = 'Suivre';
            amount = minBet;
            const white = '\x1b[37m';
            if (minBet === 0) {
                console.log(`${bold}${white}Décision : Suivre (Check)${resetColor}`);
            } else {
                console.log(`${bold}Décision : Suivre (Call) pour ${minBet}${resetColor}`);
            }
        } else {
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
        }
        return { action, amount };
    }

    // Décision de relancer (Raise) si winRate élevé, avec contrôle du risque via agressivité et bankroll
    const minBetPct = bankroll > 0 ? minBet / bankroll : 1;
    if (winRate >= raiseThreshold) {
        if (minBetPct > 0.5) {
            // Mise trop élevée (>50% bankroll), mieux vaut se coucher même avec une bonne main
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold) car mise ${minBet} > 50% de la bankroll (${bankroll})${resetColor}`);
            return { action, amount };
        } else if (minBetPct > 0.3) {
            // Mise importante (>30% bankroll) : on évite de sur-relancer, on se contente de suivre si la main est correcte
            action = 'Suivre';
            amount = minBet;
            const yellow = '\x1b[33m';
            console.log(`${bold}${yellow}Décision : Suivre (Call) car mise ${minBet} ~> 30% de la bankroll, relance trop risquée${resetColor}`);
            return { action, amount };
        } else {
            // Relance agressive possible : calcul du montant optimal (max 80% du pot ou 50% de la bankroll, modulé par agressivité)
            let maxRaisePot = Math.floor(pot * (0.8 * aggressiveness));
            let maxRaiseBankroll = Math.floor(bankroll * (0.5 * aggressiveness));
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
            // Déterminer la proportion de relance selon la force de la main (winRate) par rapport au seuil
            let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Relancer';
            amount = raiseAmount;
            const green = '\x1b[32m';
            console.log(`${bold}${green}Décision : Relancer (Raise) à ${raiseAmount} (calculé selon winRate et agressivité)${resetColor}`);
            return { action, amount };
        }
    }

    // Dernier cas : situation entre callThreshold et raiseThreshold (normalement on ne devrait pas y tomber à cause des retours précédents)
    console.log(`-> Suivre (Call) si mise raisonnable: ${minBet} <= ${bankroll * 0.20}`);
    if (minBet <= bankroll * 0.20) {
        action = 'Suivre';
        amount = minBet;
        console.log(`${bold}Décision : Suivre (Call) pour ${minBet}${resetColor}`);
    } else {
        action = 'Coucher';
        const red = '\x1b[31m';
        console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
    }
    return { action, amount };
}

// Boucle principale d'interaction

const historyPath = path.join(__dirname, 'historique.json');

function loadHistory() {
    if (fs.existsSync(historyPath)) {
        try {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        } catch (e) {
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
        steps: [] // tableau des étapes de la manche
    };
}

function updateGameRow(uuid, update) {
    let history = loadHistory();
    const idx = history.findIndex(row => row.uuid === uuid);
    if (idx !== -1) {
        history[idx] = { ...history[idx], ...update };
        saveHistory(history);
    }

// Ajoute une étape dans le tableau steps de la manche
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



function pokerBot() {
    console.clear();
    const style = `${aggressiveness <= 0.5 ? 'Prudent' : aggressiveness <= 1 ? 'Normal' : 'Agressif'}${bluffingEnabled ? ' (Bluff actif)' : ' (Bluff inactif)'}`;
    console.log(`=== Poker Bot - Style: ${style} ===`);

    const uuid = randomUUID();
    const now = new Date();
    let hand, pot, minBet, numPlayers, decision, bankroll;
    let community = [];

    let history = loadHistory();
    history.push(createGameRow(uuid, now));
    saveHistory(history);

    // Helper pour gérer chaque street et relance éventuelle
    function playStreet(street, needHand = false) {
        const input = getStreetInput(street, needHand);
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
        // Gestion relance
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

    playStreet('pre-flop', true);
    playStreet('flop');
    playStreet('turn');
    playStreet('river');
}


// Lancer le bot
pokerBot();