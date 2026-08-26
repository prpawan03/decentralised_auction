@echo off
echo Starting Smart Auction Network...
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker is not running. Please start Docker and try again.
    exit /b 1
)

echo Docker is running
echo.

REM Stop any existing containers
echo Stopping existing containers...
docker-compose down

echo.
echo Building and starting services...
echo    - Ganache blockchain
echo    - Backend (Truffle)
echo    - Frontend (React)
echo.

REM Start services
docker-compose up -d

echo.
echo Waiting for services to be ready...
timeout /t 5 >nul

echo.
echo All services are running!
echo.
echo Next steps:
echo    1. Open http://localhost:3000 in your browser
echo    2. Install MetaMask if you haven't already
echo    3. Configure MetaMask:
echo       - Network: http://localhost:8545
echo       - Chain ID: 1337
echo    4. Import a Ganache account to MetaMask
echo    5. Connect your wallet and start bidding!
echo.
echo View logs:
echo    docker-compose logs -f
echo.
echo Stop services:
echo    docker-compose down
echo.
pause

