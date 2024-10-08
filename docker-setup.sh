#!/bin/bash

echo "Building Docker container..."
docker-compose build

read -p "Please enter your Steam Guard code: " STEAM_GUARD_CODE

echo "Running the application with Steam Guard code..."
docker-compose run steam-app node index.js "$STEAM_GUARD_CODE"
