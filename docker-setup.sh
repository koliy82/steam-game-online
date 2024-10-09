#!/bin/bash

docker compose down --remove-orphans
echo "Building Docker container..."
docker compose build
# read -p "Please enter your Steam Guard code: " STEAM_GUARD_CODE

# echo "Running the application with Steam Guard code..."
# echo "To exit the log console, press CTRL+C"
# echo " "


# docker compose run steam-app node index.js "$STEAM_GUARD_CODE" -d
docker compose run steam-app node index.js