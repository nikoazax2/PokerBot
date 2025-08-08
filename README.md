# PokerBot

An interactive Poker bot in Node.js that assists in decision-making (fold, call, raise, bluff) based on calculated win probabilities at each street (pre-flop, flop, turn, river).
This is a "cheating" bot using the `poker-evaluator` library to evaluate poker hands and determine the best action given the current situation. Each game’s history is automatically recorded in a JSON file.

## Use it 

You can use it directly here : [![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/nikoazax2/PokerBot)


## Features

- Manual input of cards and bet amounts via the terminal
- Automatic calculation of winning odds using the `poker-evaluator` library
- Decision-making logic driven by probability, game context (bankroll, pot size, minimum bet), aggressiveness, and bluff behavior
- Display of recommended actions and bet sizes
- Full game history saved in `historique.json` (date, time, hand, community cards, bankroll, decision, etc.)

## Installation

1. Clone the repository or copy the files into a local folder.
2. Install dependencies:
   ```bash
   npm install poker-evaluator readline-sync
   ```

## Usage

Run the bot with Node.js:
```bash
node bot.js
```
Follow the prompts in the terminal to enter your hand, community cards, pot size, bankroll, and more. The bot will advise the optimal action at each stage and record the session in the history file.

## Input Conventions

### Cards
- Expected format: `<value><suit>`
- Values:
  - `1` = Ace, `2–10` = numbered cards, `11` = Jack, `12` = Queen, `13` = King
- Suits:
  - `co` = hearts (h)
  - `ca` = diamonds (d)
  - `tr` = clubs (c)
  - `pi` = spades (s)
- Examples:
  - `13pi` = King of spades
  - `2co` = 2 of hearts

### Bet Amounts
- Enter amounts as numbers or with the `k` suffix for thousands.
- Examples:
  - `1500` ⇒ 1500
  - `2k` ⇒ 2000

## Main Files

- `bot.js`: The main interactive bot script (records history to JSON)
- `historique.json`: Full history of all games played

## Customization

- Decision thresholds for fold/call/raise can be adjusted directly in the code.
- The percentage of bankroll allocated for raises is configurable (default: 50%).
- Aggressiveness level and bluff frequency settings are available at the top of the script.

## Dependencies

- [poker-evaluator](https://www.npmjs.com/package/poker-evaluator)
- [readline-sync](https://www.npmjs.com/package/readline-sync)

## License

Open-source project, free to use and modify.
