const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');

const aggressiveness = 2; // Niveau d'agressivité du bot (0.5 = prudent, 1 = normal, 1.5 = agressif)

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
            .question(`Entrez les cartes du ${streetName} (separees par un espace): `)
            .split(' ')
            .map(convertCard);
    }

    pot = parseAmount(readlineSync.question('Taille du pot actuel: '));
    numPlayers = parseInt(readlineSync.question('Nombre de joueurs dans le coup (incl. vous): '), 10);
    const minBetInput = readlineSync.question('Mise minimale à suivre / relancer (entrer pour 0): ');
    minBet = minBetInput.trim() === '' ? 0 : parseAmount(minBetInput);

    return { hand, community, pot, minBet, numPlayers, bankroll };
}

// Calcul de la probabilite de victoire
function evaluateOdds(hand, community, numPlayers) {
    return PokerEvaluator
        .winningOddsForPlayer(hand, community, numPlayers, 2000)
        .winRate;
}

// Prise de decision du bot et montant de relance
function makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness = 1) {
    console.log(`Calcul des chances de gagner pour la main: ${hand.join(', ')} et les cartes communes: ${community?.join(', ')} avec ${numPlayers} joueurs dans le coup. Avec une mise minimale de ${minBet}, un pot de ${pot} et votre bankroll de ${bankroll}.`);

    console.log('\n\n');


    const winRate = evaluateOdds(hand, community || [], numPlayers);
    const pct = (winRate * 100).toFixed(1);
    const bold = '\x1b[1m';
    const resetColor = '\x1b[0m';
    console.log(`${bold}Probabilite de gagner : ${pct}% ${resetColor}`);

    // Logique de décision
    let action = '';
    let amount = 0;
    let isPreflop = (community == null || community.length === 0);
    if (isPreflop) {
        //écrire la proba de gagner avec le nombre de joueurs
        const diff = (pct - 100 / numPlayers).toFixed(1);
        let diffColor;
        if (Math.abs(diff) <= 4) {
            diffColor = '\x1b[37m'; // blanc
        } else if (diff > 0) {
            diffColor = '\x1b[32m'; // vert
        } else {
            diffColor = '\x1b[31m'; // rouge
        }
        console.log(`Probabilité de gagner strictement au préflop avec ${numPlayers} joueurs: ${100 / numPlayers}% - Calcul de probabilité de gagner : ${pct}%`);
        console.log(`${bold}Différence : ${diffColor}${diff}%${resetColor}`);
        return { action: '', amount: Math.min(Math.floor(pot * 0.5)) };
    }

    // Seuils de probabilité (ajustables)
    const foldThreshold = 0.18; // < 18% : se coucher
    const callThreshold = 0.40; // 18-40% : suivre si peu cher
    // Le paramètre d'agressivité module le seuil de relance et la taille de la relance
    // aggressiveness = 1 (par défaut), <1 = prudent, >1 = agressif
    const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1); // Plus agressif = seuil plus bas

    if (winRate < foldThreshold && minBet > 0) {
        action = 'Coucher';
        const red = '\x1b[31m';
        console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
        return { action, amount };
    }

    // Si la probabilité est moyenne, suivre si la mise est raisonnable
    if (winRate < callThreshold) {
        // Seuil différent au préflop
        let potThreshold = 0.15;
        console.log(`-> Suivre (Call) si la mise est raisonnable. ${minBet} <= ${pot * potThreshold}  et ${minBet} <= ${bankroll * 0.10} `);

        if (minBet <= pot * potThreshold && minBet <= bankroll * 0.10) {
            action = 'Suivre';
            amount = minBet;
            const white = '\x1b[37m';
            if (minBet == 0) console.log(`${bold}${white}Décision : Suivre (Check) pour ${minBet}${resetColor}`);
            else console.log(`${bold}Décision : Suivre (Call) pour ${minBet}${resetColor}`);
        } else {
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
        }
        return { action, amount };
    }

    // Gestion du risque : si la mise minimale est trop élevée par rapport à la bankroll, ne pas relancer
    const minBetPct = bankroll > 0 ? minBet / bankroll : 1;
    if (winRate >= raiseThreshold) {
        if (minBetPct > 0.5) {
            // Mise trop élevée, se coucher même avec une bonne main
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold) car la mise minimale (${minBet}) > 50% de la bankroll (${bankroll})${resetColor}`);
            return { action, amount };
        } else if (minBetPct > 0.3) {
            // Trop risqué de relancer, mais on peut suivre si la proba est bonne
            action = 'Suivre';
            amount = minBet;
            const yellow = '\x1b[33m';
            console.log(`${bold}${yellow}Décision : Suivre (Call) car la mise minimale (${minBet}) > 30% de la bankroll, relance trop risquée${resetColor}`);
            return { action, amount };
        } else {
            // Plus agressif : montant max = min(80% du pot, 50% de la bankroll) modulé par l'agressivité
            let maxRaisePot = Math.floor(pot * (0.8 * aggressiveness));
            let maxRaiseBankroll = Math.floor(bankroll * (0.5 * aggressiveness));
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);

            // Modulation selon winRate et agressivité
            let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Relancer';
            amount = raiseAmount;
            const green = '\x1b[32m';
            console.log(`${bold}${green}Décision : Relancer (Raise) à ${raiseAmount} (modulé selon winRate, agressivité, plafond: ${Math.floor(0.8 * aggressiveness * 100)}% pot ou ${Math.floor(0.5 * aggressiveness * 100)}% bankroll)${resetColor}`);

            return { action, amount };
        }
    }

    // Si la probabilité est moyenne, suivre si la mise est raisonnable
    if (winRate < callThreshold) {
        // Seuil différent au préflop
        let potThreshold = 0.15;
        console.log(`-> Suivre (Call) si la mise est raisonnable. ${minBet} <= ${pot * potThreshold}  et ${minBet} <= ${bankroll * 0.10} `);

        if (minBet <= pot * potThreshold && minBet <= bankroll * 0.10) {
            action = 'Suivre';
            amount = minBet;
            const white = '\x1b[37m';
            if (minBet == 0) console.log(`${bold}${white}Décision : Suivre (Check) pour ${minBet}${resetColor}`);
            else console.log(`${bold}Décision : Suivre (Call) pour ${minBet}${resetColor}`);
        } else {
            action = 'Coucher';
            const red = '\x1b[31m';
            console.log(`${bold}${red}Décision : Se coucher (Fold)${resetColor}`);
        }
        return { action, amount };
    }

    // Si la probabilité est entre callThreshold et raiseThreshold, suivre si la mise est raisonnable
    if (winRate < raiseThreshold) {
        console.log(`-> Suivre (Call) si la mise est raisonnable. ${minBet} <= ${bankroll * 0.20} `);
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
}

// Boucle principale

function pokerBot() {
    console.clear(); 
    console.log(`=== Poker Bot - ${aggressiveness<= 0.5 ? 'Prudent' : aggressiveness <= 1 ? 'Normal' : 'Agressif'} ===`);

    // Declare variables once
    let hand, pot, minBet, numPlayers, decision, bankroll;
    let community = [];

    // pre-flop
    ({ hand, pot, minBet, numPlayers, bankroll } = getStreetInput('pre-flop', true));
    decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);

    // flop
    let flopInput = getStreetInput('flop');
    console.log(`Community cards after flop: ${community}`);

    community = [...community, ...(flopInput.community || [])];
    pot = flopInput.pot;
    minBet = flopInput.minBet;
    numPlayers = flopInput.numPlayers;
    decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    let relance = readlineSync.question('Quelqu\'un a-t-il relancé au flop ? (o/n): ', { defaultInput: 'n' }).toLowerCase();
    if (relance === 'o') {
        const newMinBetInput = readlineSync.question('Nouvelle mise minimale à suivre / relancer: ');
        minBet = newMinBetInput.trim() === '' ? 0 : parseInt(newMinBetInput, 10);
        numPlayers = parseInt(readlineSync.question('Nombre de joueurs ayant suivi la relance (incl. vous): '), 10);
        decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    }

    // turn
    let turnInput = getStreetInput('turn');
    community = [...community, ...(turnInput.community || [])];
    pot = turnInput.pot;
    minBet = turnInput.minBet;
    numPlayers = turnInput.numPlayers;
    decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    relance = readlineSync.question('Quelqu\'un a-t-il relancé au turn ? (o/n): ', { defaultInput: 'n' }).toLowerCase();
    if (relance === 'o') {
        const newMinBetInput = readlineSync.question('Nouvelle mise minimale à suivre / relancer: ');
        minBet = newMinBetInput.trim() === '' ? 0 : parseInt(newMinBetInput, 10);
        numPlayers = parseInt(readlineSync.question('Nombre de joueurs ayant suivi la relance (incl. vous): '), 10);
        decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    }

    // river
    let riverInput = getStreetInput('river');
    community = [...community, ...(riverInput.community || [])];
    pot = riverInput.pot;
    minBet = riverInput.minBet;
    numPlayers = riverInput.numPlayers;
    decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    relance = readlineSync.question('Quelqu\'un a-t-il relancé à la river ? (o/n): ', { defaultInput: 'n' }).toLowerCase();
    if (relance === 'o') {
        const newMinBetInput = readlineSync.question('Nouvelle mise minimale à suivre / relancer: ');
        minBet = newMinBetInput.trim() === '' ? 0 : parseInt(newMinBetInput, 10);
        numPlayers = parseInt(readlineSync.question('Nombre de joueurs ayant suivi la relance (incl. vous): '), 10);
        decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
    }
}

pokerBot();

