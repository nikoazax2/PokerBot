#!/usr/bin/env node
const express = require('express');
const path = require('path');
const PokerEvaluator = require('poker-evaluator');

// ====== Settings (same defaults as your CLI) ======
let aggressiveness = 1; // 0.5 cautious, 1 normal, 1.5 aggressive
let bluffingEnabled = true;
let bluffFrequency = 0.5; // 0..1

// ====== Helpers copied/adapted from your script ======
function convertCard(card) {
    const c = (card || '').trim().toLowerCase();
    const m = c.match(/^(?:([1-9]|1[0-3])|([aqjkt]))(co|ca|tr|pi|h|d|c|s)$/i);
    if (!m) return card; // return as-is if it doesn't match
    let rankRaw = m[1] || m[2];
    let suitRaw = m[3];
    let rank;
    if (/^\d+$/.test(rankRaw)) {
        rank = { '1': 'A', '10': 'T', '11': 'J', '12': 'Q', '13': 'K' }[rankRaw] || rankRaw;
    } else {
        rank = rankRaw.toUpperCase();
    }
    let suitLetter;
    switch (suitRaw.toLowerCase()) {
        case 'co': case 'h': suitLetter = 'h'; break; // hearts
        case 'ca': case 'd': suitLetter = 'd'; break; // diamonds
        case 'tr': case 'c': suitLetter = 'c'; break; // clubs
        case 'pi': case 's': suitLetter = 's'; break; // spades
        default: suitLetter = '';
    }
    return rank + suitLetter;
}

function evaluateOdds(hand, community, numPlayers) {
    return PokerEvaluator
        .winningOddsForPlayer(hand, community, numPlayers, 2000)
        .winRate;
}

function makeDecision(hand, community, pot, minBet, numPlayers, bankroll, aggr = 1, bluffEnabled = true, bluffFreq = 0.5) {
    const winRate = evaluateOdds(hand, community || [], numPlayers);
    const pct = winRate;

    const isPreflop = !community || community.length === 0;
    const foldThreshold = 0.18;
    const callThreshold = 0.40;
    const raiseThreshold = 0.33 - 0.10 * (aggr - 1);

    let action = 'Fold';
    let amount = 0;

    if (isPreflop) {
        if (pct < foldThreshold) {
            action = 'Fold';
            return { action, amount, winRate: pct };
        } else if (pct < callThreshold) {
            action = (minBet === 0) ? 'Check' : 'Call';
            amount = minBet;
            return { action, amount, winRate: pct };
        } else {
            let maxRaisePot = Math.floor(pot * 0.5);
            let maxRaiseBankroll = Math.floor(bankroll * 0.3);
            let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
            let factor = (pct - raiseThreshold) / (1 - raiseThreshold);
            factor = Math.max(0, Math.min(1, factor));
            let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
            if (raiseAmount < minBet) raiseAmount = minBet;
            action = 'Raise';
            amount = raiseAmount;
            return { action, amount, winRate: pct };
        }
    }

    // postflop
    let effectiveBluffFreq = bluffFreq;
    if (numPlayers > 2) effectiveBluffFreq *= 0.5;

    if (pct < foldThreshold && minBet > 0) {
        if (bluffEnabled && Math.random() < effectiveBluffFreq) {
            let bluffAmount = Math.floor(pot * 0.5);
            if (bluffAmount < minBet * 2) bluffAmount = minBet * 2;
            if (bluffAmount > bankroll * 0.5) bluffAmount = Math.floor(bankroll * 0.5);
            if (bluffAmount <= 0) bluffAmount = minBet || 1;
            return { action: 'Raise (bluff)', amount: bluffAmount, winRate: pct };
        }
        return { action: 'Fold', amount: 0, winRate: pct };
    }

    if (pct < callThreshold) {
        if (bluffEnabled && minBet === 0 && Math.random() < effectiveBluffFreq) {
            let bluffBet = Math.floor(pot * 0.5);
            if (bluffBet > bankroll * 0.3) bluffBet = Math.floor(bankroll * 0.3);
            if (bluffBet < 1) bluffBet = 1;
            return { action: 'Bet (bluff)', amount: bluffBet, winRate: pct };
        }
        if (minBet <= pot * 0.15 && minBet <= bankroll * 0.10) {
            return { action: minBet === 0 ? 'Check' : 'Call', amount: minBet, winRate: pct };
        }
        return { action: 'Fold', amount: 0, winRate: pct };
    }

    const minBetPct = bankroll > 0 ? minBet / bankroll : 1;
    if (pct >= raiseThreshold) {
        if (minBetPct > 0.5) return { action: 'Fold', amount: 0, winRate: pct };
        if (minBetPct > 0.3) return { action: 'Call', amount: minBet, winRate: pct };
        let maxRaisePot = Math.floor(pot * (0.8 * aggr));
        let maxRaiseBankroll = Math.floor(bankroll * (0.5 * aggr));
        let maxRaise = Math.min(maxRaisePot, maxRaiseBankroll);
        let factor = (pct - raiseThreshold) / (1 - raiseThreshold);
        factor = Math.max(0, Math.min(1, factor));
        let raiseAmount = Math.floor(minBet + factor * (maxRaise - minBet));
        if (raiseAmount < minBet) raiseAmount = minBet;
        return { action: 'Raise', amount: raiseAmount, winRate: pct };
    }

    if (minBet <= bankroll * 0.20) return { action: 'Call', amount: minBet, winRate: pct };
    return { action: 'Fold', amount: 0, winRate: pct };
}

// ====== Express app ======
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/decide  — body: { hand: 'kc 4s', community: '2h 7d 9c', pot, minBet, numPlayers, bankroll, aggressiveness, bluffingEnabled, bluffFrequency }
app.post('/api/decide', (req, res) => {
    try {
        const {
            hand = '',
            community = '',
            pot = 0,
            minBet = 0,
            numPlayers = 2,
            bankroll = 0,
            aggressiveness: aggrBody,
            bluffingEnabled: bluffOn,
            bluffFrequency: bluffFreq
        } = req.body || {};

        const handArr = String(hand).split(/\s+/).filter(Boolean).map(convertCard);
        const commArr = String(community).split(/\s+/).filter(Boolean).map(convertCard);

        const result = makeDecision(
            handArr,
            commArr,
            Number(pot) || 0,
            Number(minBet) || 0,
            Number(numPlayers) || 2,
            Number(bankroll) || 0,
            aggrBody != null ? Number(aggrBody) : aggressiveness,
            bluffOn != null ? !!bluffOn : bluffingEnabled,
            bluffFreq != null ? Number(bluffFreq) : bluffFrequency
        );

        res.json({
            input: { hand: handArr, community: commArr, pot, minBet, numPlayers, bankroll },
            decision: result
        });
    } catch (e) {
        res.status(400).json({ error: e.message || 'Bad request' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PokerBot web running on http://localhost:${PORT}`);
});