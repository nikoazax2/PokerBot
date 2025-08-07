// Script simple pour évaluer la probabilité de gagner au poker
const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');




function convertCard(card) {
    const c = card.trim().toLowerCase();
    const m = c.match(/^([1]?[0-9]{1,2}|[a-z]{1,2})(co|ca|tr|pi)$/);
    if (m) {
        let num = m[1];
        let suit = m[2];
        const rank = { '1': 'A', 'a': 'A', 'as': 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': 'T', '11': 'J', '12': 'Q', '13': 'K', 'j': 'J', 'q': 'Q', 'k': 'K', 't': 'T' }[num] || num.toUpperCase();
        const suitLetter = { co: 'h', ca: 'd', tr: 'c', pi: 's' }[suit] || '';
        return rank + suitLetter;
    }
    // fallback: format classique
    let cc = card.trim().toUpperCase();
    cc = cc.replace(/I0|1O/g, '10');
    cc = cc.replace(/10([HDCS])/, 'T$1');
    cc = cc.replace(/10$/, 'T');
    cc = cc.replace(/([AKQJT98765432])([HDCS])/, (m, r, s) => r + s);
    return cc;
}


function ensureFullCard(card) {
    if (!/[HDCS]$/i.test(card)) {
        let full;
        while (true) {
            full = readlineSync.question(`La carte "${card}" manque de couleur. Donne-la complète (ex: Ah, Ks ou 13pi): `).trim();
            full = convertCard(full);
            if (/^[AKQJT98765432T]{1,2}[HDCS]$/i.test(full)) break;
            console.log('Format invalide, réessaie.');
        }
        return full;
    }
    return card;
}



function askHand() {
    while (true) {
        let input = readlineSync.question('Entrez votre main (2 cartes, ex: Ah Ks ou 13pi 2co): ').trim();
        let parts = input.split(/\s+/).filter(Boolean);
        if (parts.length === 2) {
            let hand = parts.map(convertCard).map(ensureFullCard);
            if (hand.every(c => /^[AKQJT98765432T]{1,2}[HDCS]$/i.test(c))) {
                return hand;
            }
        }
        console.log('Format invalide, réessaie.');
    }
}




function askCommunity() {
    const n = readlineSync.question('Combien de cartes sur le board ? (3, 4 ou 5, Entrée pour aucun): ').trim();
    let count = parseInt(n, 10);
    if (isNaN(count) || count < 3 || count > 5) count = 0;
    if (count === 0) return [];
    while (true) {
        let input = readlineSync.question(`Entrez les ${count} cartes du board séparées par espace (ex: 5c Jh Td ou 10co 11pi 2ca): `).trim();
        let parts = input.split(/\s+/).filter(Boolean);
        if (parts.length === count) {
            let community = parts.map(convertCard).map(ensureFullCard);
            if (community.every(c => /^[AKQJT98765432T]{1,2}[HDCS]$/i.test(c))) {
                return community;
            }
        }
        console.log('Format invalide, réessaie.');
    }
}


function askNumPlayers() {
    while (true) {
        const n = readlineSync.question('Nombre de joueurs en jeu (2 à 10): ').trim();
        const num = parseInt(n, 10);
        if (!isNaN(num) && num >= 2 && num <= 10) return num;
        console.log('Entrée invalide, donne un nombre entre 2 et 10.');
    }
}

function main() {
    console.log('--- Évaluation de la main de poker ---');
    const hand = askHand();
    const community = askCommunity();
    const numPlayers = askNumPlayers();
    const winRate = PokerEvaluator.winningOddsForPlayer(hand, community, numPlayers, 2000).winRate;
    //Porbabilité brut
    console.log(`Probabilité brute de gagner : ${100 / numPlayers}%`);
    console.log(`Probabilité de gagner : ${(winRate * 100).toFixed(1)}%`);
    //différence (si positive vert ou négative rouge)
    const diff = (winRate - (1 / numPlayers)) * 100;
    if (diff > 0) {
        const green = '\x1b[32m';
        const reset = '\x1b[0m';
        console.log(`${green}Différence positive : +${diff.toFixed(1)}% (avantage)${reset}`);
    }
    else if (diff < 0) {
        const red = '\x1b[31m';
        const reset = '\x1b[0m';
        console.log(`${red}Différence négative : ${diff.toFixed(1)}% (désavantage)${reset}`);
    } else {
        console.log('Pas d\'avantage ni de désavantage.');
    }
}

main();
