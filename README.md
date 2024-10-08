# Script for farming hours in your favorite Steam games. 😁

## Features
- Automatic login to Steam account
- Ability to specify multiple games for simultaneous farming
- Configuration through `.env` file
- Docker support for easy deployment


## Installation
1. Clone the repository:
```
git clone https://github.com/koliy82/steam-game-online
cd steam-game-online
```
   
2. Create a `.env` file based on [`.env.example`](https://github.com/koliy82/steam-game-online/blob/main/.env.example) and fill it with your data:

```
STEAM_USERNAME=username
STEAM_PASSWORD=password

# FOR MORE GAMES THEN ONE USE:
# GAMES_IDS=219780,440,730
# In steam will be display first id, 
# but the hours are incremented for all games. 
GAMES_IDS=219780
```

## Usage
If u have docker installed, just run `./docker-setup.sh`. Either way u need to install node, and run it with comand below, and keep console open.
```js
node index.js YOUR_STEAM_GUARD_CODE
```

## Limitations
If you fail to log into your account many times, steam will limit your requests and you'll just have to try again later.
