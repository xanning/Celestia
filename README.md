# Celestia (Hypixel Bedwars queue botter)

Written in Nodejs, an barebones incomplete queue botting program. Has basic features and a dashboard to monitor the bots.

# Setup

Download the repo

Unzip it

Open a terminal / command line in the folder and type `npm install` to install the dependencies

Put your proxies in proxies.txt (optional) and tokens in tokens.txt

Run with `node index.js`

For every bot, it'll spawn a seperate console window for you to monitor the logs.

# Tokens

It uses mctokens. MCTokens are the minecraft access_tokens which most altshops sell.

The format is:

username:uuid:token for each line

If you don't provide username or uuid, and just the token, the script will automatically query them and place it for you, when you run the program.

# Incomplete stuff

- Pathfinding doesn't work. Currenty just uses goto to go random places to not get AFK'ed.

- walkToShop implementation isnt correct and cant bother to fix it.

- pregame lobby groups sometimes break, probably because i don't clear the cache or smthn. Doesn't break the tool though

- is not advanced. can't pick maps and such. no party stuff.

# Info

Boredom, novo had a botting program and I didn't and that made me mad. Had a dopamine boost making this for like an hour, then it died down and I got bored again, back to Ritalin i guess.

