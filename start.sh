#!/bin/bash

echo "🚀 Starting Smart Auction Network..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

echo "✓ Docker is running"
echo ""

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

echo ""
echo "🏗️  Building and starting services..."
echo "   - Ganache blockchain"
echo "   - Backend (Truffle)"
echo "   - Frontend (React)"
echo ""

# Start services
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if services are running
if docker ps | grep -q "auction_ganache\|auction_frontend\|auction_backend"; then
    echo ""
    echo "✅ All services are running!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Open http://localhost:3000 in your browser"
    echo "   2. Install MetaMask if you haven't already"
    echo "   3. Configure MetaMask:"
    echo "      - Network: http://localhost:8545"
    echo "      - Chain ID: 1337"
    echo "   4. Import a Ganache account to MetaMask"
    echo "   5. Connect your wallet and start bidding!"
    echo ""
    echo "🔍 View logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "🛑 Stop services:"
    echo "   docker-compose down"
    echo ""
else
    echo ""
    echo "❌ Some services failed to start. Check logs with:"
    echo "   docker-compose logs"
    echo ""
    exit 1
fi

