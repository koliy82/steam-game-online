# Script for farming hours in your favorite Steam games. 😁

## Features
- Automatic login to Steam account
- Ability to specify multiple games for simultaneous farming
- Configuration through `.env` file
- Docker support for easy deployment


## Installation
1. Clone the repository:
```sh
git clone https://github.com/koliy82/steam-game-online
cd steam-game-online
```
   
2. Create a `.env` file based on [`.env.example`](https://github.com/koliy82/steam-game-online/blob/main/.env.example) and fill it with your data:

```
STEAM_USERNAME=username
STEAM_PASSWORD=password
GAMES_IDS=219780
```
The `GAMES_IDS` variable can be set in 3 ways:
1) `GAMES_IDS=219780` - For one game, in the game link after the app/ you will be able to find the ID of that game:
(https://store.steampowered.com/app/ --> 219780 <-- here /Divinity_II_Developers_Cut/)
2) `GAMES_IDS=219780,440,730` - Same thing, just a day of multiple games at once. IDs are entered with a comma. Only one game will be displayed, but the hours will be farmed for all of them.
3) `GAMES_IDS=Custom Game Name` - Just any text, Steam will display it as if you are playing a third-party game with that text.

## Usage
You need to install node, and run it with comand below, and keep console open.
```sh
node index.js YOUR_STEAM_GUARD_CODE
```

## Usage with Docker
If u have docker installed, just run `./docker-setup.sh`. 
Wait until you are asked to enter Steam Guard, after entering it you can close the console (CTRL+C).


## Limitations
If you fail to log into your account many times, steam will limit your requests and you'll just have to try again later or use proxy.
