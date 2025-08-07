
# PokerBot

Un bot de poker interactif en Node.js qui aide à prendre des décisions (fold, call, raise, bluff) selon la probabilité de victoire calculée à chaque street (pré-flop, flop, turn, river). 
C'est un bot de triche qui utilise la librairie `poker-evaluator` pour évaluer les mains de poker et déterminer la meilleure action à prendre en fonction de la situation. L'historique de chaque partie est enregistré automatiquement dans un fichier JSON.

## Fonctionnalités
- Saisie manuelle des cartes et des montants via le terminal
- Calcul automatique des probabilités de victoire avec la librairie `poker-evaluator`
- Prise de décision basée sur la probabilité, la situation (bankroll, pot, mise minimale), l'agressivité et le bluff
- Affichage des conseils et des montants à jouer
- Historique complet de toutes les parties dans `historique.json` (date, heure, main, communauté, bankroll, décision...)

## Installation

1. Clonez le dépôt ou copiez les fichiers dans un dossier local.
2. Installez les dépendances :
   ```bash
   npm install poker-evaluator readline-sync
   ```

## Utilisation

Lancez le bot avec Node.js :
```bash
node bot.js
```

Suivez les instructions dans le terminal pour entrer votre main, les cartes communes, le pot, la bankroll, etc. Le bot vous indiquera la meilleure action à chaque étape et enregistrera la partie dans l'historique.

## Conventions de saisie

### Cartes
- Format attendu : `<valeur><sorte>`
- Valeurs :
  - 1 = As, 2–10 = chiffres, 11 = Valet, 12 = Dame, 13 = Roi
- Sortes :
  - `co` = cœur (h)
  - `ca` = carreau (d)
  - `tr` = trèfle (c)
  - `pi` = pique (s)
- Exemples :
  - `13pi` = Roi de pique
  - `2co` = 2 de cœur

### Montants
- Les montants peuvent être saisis en chiffres ou avec le suffixe `k` pour les milliers.
- Exemples :
  - `1500` = 1500
  - `2k` = 2000

## Fichiers principaux
- `bot.js` : version principale du bot interactif (avec historique JSON)
- `historique.json` : historique complet des parties jouées

## Personnalisation
- Les seuils de décision (fold/call/raise) sont modifiables dans le code.
- Le pourcentage de bankroll utilisé pour les relances est ajustable (par défaut 50%).
- Le niveau d'agressivité et la fréquence de bluff sont configurables en haut du script.

## Dépendances
- [poker-evaluator](https://www.npmjs.com/package/poker-evaluator)
- [readline-sync](https://www.npmjs.com/package/readline-sync)

## Licence
Projet open-source, libre d'utilisation et de modification.
