# PokerBot

Un bot de poker interactif en Node.js qui aide à prendre des décisions (fold, call, raise) selon la probabilité de victoire calculée à chaque street (pré-flop, flop, turn, river).

## Fonctionnalités
- Saisie manuelle des cartes et des montants via le terminal
- Calcul automatique des probabilités de victoire avec la librairie `poker-evaluator`
- Prise de décision basée sur la probabilité et la situation (bankroll, pot, mise minimale)
- Affichage des conseils et des montants à jouer

## Installation

1. Clonez le dépôt ou copiez les fichiers dans un dossier local.
2. Installez les dépendances :
   ```bash
   npm install poker-evaluator readline-sync
   ```

## Utilisation

Lancez le bot avec Node.js :
```bash
node bot2.js
```

Suivez les instructions dans le terminal pour entrer votre main, les cartes communes, le pot, la bankroll, etc. Le bot vous indiquera la meilleure action à chaque étape.

## Fichiers principaux
- `bot2.js` : version principale du bot interactif
- `bot.js` : version alternative ou ancienne
- `pokerBot_log.json` : journal des parties (optionnel)

## Personnalisation
- Les seuils de décision (fold/call/raise) sont modifiables dans le code.
- Le pourcentage de bankroll utilisé pour les relances est ajustable (par défaut 50%).

## Dépendances
- [poker-evaluator](https://www.npmjs.com/package/poker-evaluator)
- [readline-sync](https://www.npmjs.com/package/readline-sync)

## Licence
Projet open-source, libre d'utilisation et de modification.
