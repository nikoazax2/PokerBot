const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// Bot settings
const aggressiveness = 1; // Bot aggressiveness level (0.5 = cautious, 1 = normal, 1.5 = aggressive)
const bluffingEnabled = true; // Enable/disable bluffing behavior
const bluffFrequency = 0.5;   // Bluff frequency (e.g., 0.2 = 20% chance to bluff in opportunistic situations)

// Convert input card notation to poker-evaluator format
// Supports French suit codes (co, ca, tr, pi) or English suit letters (h, d, c, s)
// Allows ranks as numbers (1-13) or letters (A, K, Q, J, T)
function convertCard(card) {
    const c = card.trim().toLowerCase();
    // Match rank (number 1-13 or letter A, K, Q, J, T) and suit
    const m = c.match(/^(?:([1-9]|1[0-3])|([aqjkt]))(co|ca|tr|pi|h|d|c|s)$/i);
    if (!m) return card;
    // m[1] = numeric rank, m[2] = letter rank, m[3] = suit code
    let rankRaw = m[1] || m[2];
    let suitRaw = m[3];
    // Normalize rank
    let rank;
    if (/^\d+$/.test(rankRaw)) {
        rank = { '1': 'A', '10': 'T', '11': 'J', '12': 'Q', '13': 'K' }[rankRaw] || rankRaw;
    } else {
        rank = rankRaw.toUpperCase();
    }
    // Normalize suit to single letter
    let suitLetter;
    switch (suitRaw) {
        case 'co': case 'h': suitLetter = 'h'; break; // hearts
        case 'ca': case 'd': suitLetter = 'd'; break; // diamonds
        case 'tr': case 'c': suitLetter = 'c'; break; // clubs
        case 'pi': case 's': suitLetter = 's'; break; // spades
        default: suitLetter = '';
    }
    return rank + suitLetter;
}

// Parse a bet amount string into a number (supports 'k' suffix)
function parseAmount(input) {
    input = input.trim().toLowerCase();
    if (input.endsWith('k')) {
        return parseInt(input.replace('k', ''), 10) * 1000;
    }
    return parseInt(input, 10);
}

// Read input values for each street
function getStreetInput(streetName, needHand = false) {
    let hand, community, pot, minBet, numPlayers, bankroll;

    if (streetName === 'pre-flop') {
        bankroll = parseAmount(readlineSync.question('Your current bankroll: '));
    }

    if (needHand) {
        hand = readlineSync
            .question('Enter your hand (2 cards, e.g. "13c kc" or "Aco 10h"): ')
            .split(/\s+/)
            .map(convertCard);
    }

    if (streetName !== 'pre-flop') {
        community = readlineSync
            .question(`Enter the ${streetName} cards (separated by a space): `)
            .split(/\s+/)
            .map(convertCard);
    }

    pot = parseAmount(readlineSync.question('Current pot size: '));
    numPlayers = parseInt(readlineSync.question('Number of players in the hand (including you): '), 10);
    const minBetInput = readlineSync.question('Minimum bet to call/raise (press Enter for 0): ');
    minBet = minBetInput.trim() === '' ? 0 : parseAmount(minBetInput);

    return { hand, community, pot, minBet, numPlayers, bankroll };
}

// Calculate win probability
function evaluateOdds(hand, community, numPlayers) {
    return PokerEvaluator
        .winningOddsForPlayer(hand, community, numPlayers, 2000)
        .winRate;
}

// Bot decision logic and raise amount calculation
function makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness = 1) {
    console.log(`Calculating win odds for hand: ${hand.join(', ')} and community cards: ${community?.join(', ')} with ${numPlayers} players. Minimum to call: ${minBet}, Pot: ${pot}, Bankroll: ${bankroll}.`);
    console.log('\n');

    const winRate = evaluateOdds(hand, community || [], numPlayers);
    const pct = (winRate * 100).toFixed(1);
    const bold = '\x1b[1m';
    const reset = '\x1b[0m';
    console.log(`${bold}Win probability: ${pct}%${reset}`);

    let action = '';
    let amount = 0;
    const isPreflop = !community || community.length === 0;

    if (isPreflop) {
        const diff = (pct - 100 / numPlayers).toFixed(1);
        let diffColor;
        if (Math.abs(diff) <= 4) {
            diffColor = '\x1b[37m'; // neutral
        } else if (diff > 0) {
            diffColor = '\x1b[32m'; // better
        } else {
            diffColor = '\x1b[31m'; // worse
        }
        console.log(`Theoretical win rate with ${numPlayers} players: ${(100 / numPlayers).toFixed(1)}% vs actual: ${pct}%`);
        console.log(`${bold}Difference: ${diffColor}${diff}%${reset}`);

        const foldThreshold = 0.18;
        const callThreshold = 0.40;
        const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);

        if (winRate < foldThreshold) {
            action = 'Fold';
            console.log(`${bold}\x1b[31mPre-flop decision: Fold${reset}`);
            return { action, amount };
        } else if (winRate < callThreshold) {
            action = 'Call';
            amount = minBet;
            if (minBet === 0) {
                console.log(`${bold}\x1b[37mPre-flop decision: Check${reset}`);
            } else {
                console.log(`${bold}Pre-flop decision: Call ${minBet}${reset}`);
            }
            return { action, amount };
        } else {
            let maxRaisePot = Math.floor(pot * 0.5);
            let maxRaiseBankroll = Math.floor(bankroll * 0.3);
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
            let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Raise';
            amount = raiseAmount;
            console.log(`${bold}\x1b[32mPre-flop decision: Raise to ${raiseAmount}${reset}`);
            return { action, amount };
        }
    }

    const foldThreshold = 0.18;
    const callThreshold = 0.40;
    const raiseThreshold = 0.33 - 0.10 * (aggressiveness - 1);

    let effectiveBluffFreq = bluffFrequency;
    if (numPlayers > 2) effectiveBluffFreq *= 0.5;

    // Fold logic with possible bluff
    if (winRate < foldThreshold && minBet > 0) {
        if (bluffingEnabled && Math.random() < effectiveBluffFreq) {
            action = 'Raise';
            let bluffAmount = Math.floor(pot * 0.5);
            if (bluffAmount < minBet * 2) bluffAmount = minBet * 2;
            if (bluffAmount > bankroll * 0.5) bluffAmount = Math.floor(bankroll * 0.5);
            if (bluffAmount <= 0) bluffAmount = minBet || 1;
            amount = bluffAmount;
            console.log(`${bold}\x1b[35mDecision: Bluff raise to ${bluffAmount}${reset}`);
            return { action, amount };
        } else {
            action = 'Fold';
            console.log(`${bold}\x1b[31mDecision: Fold${reset}`);
            return { action, amount };
        }
    }

    // Call logic with possible donk bluff
    if (winRate < callThreshold) {
        if (bluffingEnabled && minBet === 0 && Math.random() < effectiveBluffFreq) {
            action = 'Raise';
            let bluffBet = Math.floor(pot * 0.5);
            if (bluffBet > bankroll * 0.3) bluffBet = Math.floor(bankroll * 0.3);
            if (bluffBet < 1) bluffBet = 1;
            amount = bluffBet;
            console.log(`${bold}\x1b[35mDecision: Bet ${amount} as a bluff${reset}`);
            return { action, amount };
        }

        console.log(`-> Call if reasonable: ${minBet} <= ${pot * 0.15} and ${minBet} <= ${bankroll * 0.10}`);
        if (minBet <= pot * 0.15 && minBet <= bankroll * 0.10) {
            action = 'Call';
            amount = minBet;
            if (minBet === 0) {
                console.log(`${bold}\x1b[37mDecision: Check${reset}`);
            } else {
                console.log(`${bold}Decision: Call ${minBet}${reset}`);
            }
        } else {
            action = 'Fold';
            console.log(`${bold}\x1b[31mDecision: Fold${reset}`);
        }
        return { action, amount };
    }

    // Raise logic for strong hands
    const minBetPct = bankroll > 0 ? minBet / bankroll : 1;
    if (winRate >= raiseThreshold) {
        if (minBetPct > 0.5) {
            action = 'Fold';
            console.log(`${bold}\x1b[31mDecision: Fold because bet ${minBet} > 50% of bankroll (${bankroll})${reset}`);
            return { action, amount };
        } else if (minBetPct > 0.3) {
            action = 'Call';
            amount = minBet;
            console.log(`${bold}\x1b[33mDecision: Call because bet ${minBet} ~> 30% of bankroll, raise too risky${reset}`);
            return { action, amount };
        } else {
            let maxRaisePot = Math.floor(pot * (0.8 * aggressiveness));
            let maxRaiseBankroll = Math.floor(bankroll * (0.5 * aggressiveness));
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
            let factor = (winRate - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Raise';
            amount = raiseAmount;
            console.log(`${bold}\x1b[32mDecision: Raise to ${raiseAmount} (calculated based on winRate and aggressiveness)${reset}`);
            return { action, amount };
        }
    }

    // Fallback call/fold
    console.log(`-> Call if reasonable: ${minBet} <= ${bankroll * 0.20}`);
    if (minBet <= bankroll * 0.20) {
        action = 'Call';
        amount = minBet;
        console.log(`${bold}Decision: Call ${minBet}${reset}`);
    } else {
        action = 'Fold';
        console.log(`${bold}\x1b[31mDecision: Fold${reset}`);
    }
    return { action, amount };
}

// History file path
const historyPath = path.join(__dirname, 'history.json');

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
        time: now.toLocaleTimeString(),
        steps: []
    };
}

function addStepToHistory(uuid, stepData) {
    let history = loadHistory();
    const index = history.findIndex(row => row.uuid === uuid);
    if (index !== -1) {
        if (!Array.isArray(history[index].steps)) history[index].steps = [];
        history[index].steps.push(stepData);
        saveHistory(history);
    }
}

// Main interaction loop
function pokerBot() {
    console.clear();
    const style = `${aggressiveness <= 0.5 ? 'Cautious' : aggressiveness <= 1 ? 'Normal' : 'Aggressive'}${bluffingEnabled ? ' (Bluff enabled)' : ' (Bluff disabled)'}`;
    console.log(`=== Poker Bot - Style: ${style} ===`);

    const uuid = randomUUID();
    const now = new Date();
    let hand, community = [], pot, minBet, numPlayers, decision, bankroll;

    let history = loadHistory();
    history.push(createGameRow(uuid, now));
    saveHistory(history);

    function playStreet(street, needHand = false) {
        const input = getStreetInput(street, needHand);
        if (needHand) hand = input.hand;
        community = [...community, ...(input.community || [])];
        pot = input.pot;
        minBet = input.minBet;
        numPlayers = input.numPlayers;
        if (input.bankroll !== undefined) bankroll = input.bankroll;

        decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
        addStepToHistory(uuid, { street, hand, community: [...community], pot, minBet, numPlayers, bankroll, decision });

        if (["flop", "turn", "river"].includes(street)) {
            const raised = readlineSync.question(`Did someone raise on the ${street}? (y/n): `, { defaultInput: 'n' }).toLowerCase();
            if (raised === 'y') {
                const newMin = readlineSync.question('New minimum bet to call/raise: ');
                minBet = newMin.trim() === '' ? 0 : parseAmount(newMin);
                numPlayers = parseInt(readlineSync.question('Number of players who called the raise (including you): '), 10);
                decision = makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggressiveness);
                addStepToHistory(uuid, { street: `${street}-raise`, hand, community: [...community], pot, minBet, numPlayers, bankroll, decision });
            }
        }
    }

    playStreet('pre-flop', true);
    playStreet('flop');
    playStreet('turn');
    playStreet('river');
}

// Run the bot
pokerBot();
