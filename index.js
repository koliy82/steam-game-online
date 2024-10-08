require('dotenv').config();

const SteamUser = require('steam-user');

const user = new SteamUser();

const logOnOptions = {
  accountName: process.env.STEAM_USERNAME,
  password: process.env.STEAM_PASSWORD,
  twoFactorCode: process.argv[2],
};

user.logOn(logOnOptions);

user.on('loggedOn', () => {
  console.log(logOnOptions.accountName + ' - Successfully logged on');
  user.setPersona(1); 
  
  let games;
  if (/^\d+(,\d+)*$/.test(process.env.GAMES_IDS)) {
    games = process.env.GAMES_IDS.split(',').map(Number);
  } else {
    games = process.env.GAMES_IDS;
  }
  user.gamesPlayed(games); 
  console.log('Playing games:', games);
  
});



