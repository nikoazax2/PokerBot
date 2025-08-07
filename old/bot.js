const PokerEvaluator = require('poker-evaluator');
const readlineSync = require('readline-sync');

// Conversion de la saisie en format poker-evaluator
function convertCard(card) {
  const c = card.toLowerCase();
  const m = c.match(/^(\d+)(co|ca|tr|pi)$/);
  if (!m) return card;
  const [, num, suit] = m;
  const rank = { '1':'A','10':'T','11':'J','12':'Q','13':'K' }[num] || num;
  const suitLetter = { co:'h', ca:'d', tr:'c', pi:'s' }[suit] || '';
  return rank + suitLetter;
}

// Lecture des inputs pour chaque street
function getStreetInput(streetName, needHand = false) {
  let hand, community, pot, minBet, numPlayers;

  if (needHand) {
    hand = readlineSync
      .question('Entrez votre main (2 cartes, ex. "13pi 2co"): ')
      .split(' ')
      .map(convertCard);
  }
  community = readlineSync
    .question(`Entrez les cartes du ${streetName} (séparées par un espace): `)
    .split(' ')
    .map(convertCard);

  pot = parseInt(readlineSync.question('Taille du pot actuel: '), 10);
  minBet = parseInt(readlineSync.question('Mise minimale à suivre / relancer: '), 10);
  numPlayers = parseInt(
    readlineSync.question('Nombre de joueurs dans le coup (incl. vous): '),
    10
  );

  return { hand, community, pot, minBet, numPlayers };
}

// Calcul de la probabilité de victoire
function evaluateOdds(hand, community) {
  return PokerEvaluator
    .winningOddsForPlayer(hand, community, 2, 2000)
    .winRate;
}

// Prise de décision du bot et montant de relance
function makeDecision(hand, community, pot, minBet, numPlayers) {
  const winRate = evaluateOdds(hand, community);
  const pct = (winRate * 100).toFixed(1);
  console.log(`Probabilité de gagner : ${pct}%`);

  const raiseThreshold = Math.min(0.5 + 0.1 * (numPlayers - 2), 0.9);
  const callThreshold  = Math.min(0.2 + 0.05 * (numPlayers - 2), raiseThreshold);

  // Si pas de mise à suivre, on ne peut que check, call ou raise
  if (minBet === 0) {
    if (winRate < callThreshold) {
      console.log('→ Check.');
      return { action: 'check', amount: 0 };
    }
    if (winRate < raiseThreshold) {
      console.log('→ Check.');
      return { action: 'check', amount: 0 };
    }
    const raiseAmt = Math.max(minBet, Math.round(pot * winRate));
    console.log(`→ Raise ${raiseAmt}`);
    return { action: 'raise', amount: raiseAmt };
  }

  // Si mise à suivre, on peut fold, call ou raise
  if (winRate < callThreshold) {
    console.log('→ Se coucher.');
    return { action: 'fold', amount: 0 };
  }
  if (winRate < raiseThreshold) {
    console.log(`→ Call ${minBet}`);
    return { action: 'call', amount: minBet };
  }
  const raiseAmt = Math.max(minBet, Math.round(pot * winRate));
  console.log(`→ Raise ${raiseAmt}`);
  return { action: 'raise', amount: raiseAmt };
}

// Gestion d'une relance adverse
function handleOppRaise(pot) {
  const oppRaise = readlineSync
    .question('Un adversaire relance-t-il ? (oui/non): ')
    .toLowerCase();
  if (oppRaise === 'oui') {
    const amount = parseInt(
      readlineSync.question('Montant de la relance adverse: '),
      10
    );
    return { newPot: pot + amount, newMinBet: amount };
  }
  return null;
}

// Boucle principale
function pokerBot() {
  console.log('=== Poker Bot (flop → turn → river avec relances adverses) ===');

  while (true) {
    // --- FLOP ---
    let { hand, community: flop, pot, minBet, numPlayers } =
      getStreetInput('flop', true);
    console.log('\n-- FLOP --');
    let { action, amount } =
      makeDecision(hand, flop, pot, minBet, numPlayers);

    if (action === 'fold') {
      console.log('\n→ Bot fold au flop. Nouvelle main.\n');
      continue;
    }

    // Relance adverse au flop
    let info = handleOppRaise(pot);
    if (info) {
      pot = info.newPot;
      minBet = info.newMinBet;
      console.log('\n-- FLOP après relance adverse --');
      ({ action, amount } =
        makeDecision(hand, flop, pot, minBet, numPlayers));
      if (action === 'fold') {
        console.log('\n→ Bot fold au flop après relance adverse. Nouvelle main.\n');
        continue;
      }
    }

    // --- TURN ---
    console.log('\n-- TURN --');
    let { community: turnArr, minBet: mb1, numPlayers: np1 } =
      getStreetInput('turn');
    // on prend la première carte du tableau
    const turn = turnArr[0];
    const communityTurn = [...flop, turn];
    pot += amount;
    minBet = mb1;
    numPlayers = np1;
    ({ action, amount } =
      makeDecision(hand, communityTurn, pot, minBet, numPlayers));
    if (action === 'fold') {
      console.log('\n→ Bot fold au turn. Nouvelle main.\n');
      continue;
    }

    // Relance adverse au turn
    info = handleOppRaise(pot);
    if (info) {
      pot = info.newPot;
      minBet = info.newMinBet;
      console.log('\n-- TURN après relance adverse --');
      ({ action, amount } =
        makeDecision(hand, communityTurn, pot, minBet, numPlayers));
      if (action === 'fold') {
        console.log('\n→ Bot fold au turn après relance adverse. Nouvelle main.\n');
        continue;
      }
    }

    // --- RIVER ---
    console.log('\n-- RIVER --');
    let { community: riverArr, minBet: mb2, numPlayers: np2 } =
      getStreetInput('river');
    const river = riverArr[0];
    const communityRiver = [...communityTurn, river];
    pot += amount;
    minBet = mb2;
    numPlayers = np2;

    // 1) décision avant relance adverse
    let riverDecision =
      makeDecision(hand, communityRiver, pot, minBet, numPlayers);

    // 2) relance adverse éventuelle à la river
    info = handleOppRaise(pot);
    if (info) {
      pot = info.newPot;
      minBet = info.newMinBet;
      console.log('\n-- RIVER après relance adverse --');
      riverDecision =
        makeDecision(hand, communityRiver, pot, minBet, numPlayers);
    }

    // Affichage final
    console.log(
      `\n→ Bot a décidé "${riverDecision.action}"` +
      (riverDecision.amount ? ` ${riverDecision.amount}` : '') +
      ` à la river. Nouvelle main.\n`
    );
  }
}

pokerBot();

