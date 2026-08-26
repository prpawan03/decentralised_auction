# Smart Auction Network

A decentralized auction platform built on Ethereum blockchain, allowing users to create, bid on, and manage auctions in a trustless environment.

## Features

- **Decentralized Auctions**: Create and manage auctions using smart contracts
- **Real-time Bidding**: Place bids and see live auction updates
- **Instant Buyout**: Purchase items immediately at buyout price
- **User Authentication**: Wallet-based authentication with MetaMask
- **Modern UI**: Responsive design with Tailwind CSS

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Web3.js
- **Smart Contracts**: Solidity 0.8.19
- **Blockchain**: Ethereum (Ganache for local development)
- **Framework**: Truffle Suite
- **Containerization**: Docker & Docker Compose

## Prerequisites

- Docker and Docker Compose
- MetaMask browser extension

## Quick Start

1. **Clone the repository**
```bash
git clone <repository-url>
cd decentralised_auction
```

2. **Start all services**
```bash
docker-compose up -d
```

This will start:
- Ganache blockchain on `localhost:8545`
- Backend (Truffle) for contract deployment
- Frontend React app on `localhost:3000`

3. **Configure MetaMask**
- Network: `http://localhost:8545`
- Chain ID: `1337`
- Import one of Ganache's accounts using the private key

4. **Access the application**
- Open `http://localhost:3000` in your browser
- Connect your MetaMask wallet
- Register your username
- Start creating and bidding on auctions!

## Development

### Project Structure
```
decentralised_auction/
├── backend/
│   ├── contracts/         # Solidity smart contracts
│   ├── migrations/        # Deployment scripts
│   └── build/            # Compiled contracts
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/       # Page components
│   │   └── index.css    # Tailwind styles
│   └── public/
└── docker-compose.yml
```

### Available Commands

**Backend:**
```bash
cd backend
npm run compile    # Compile smart contracts
npm run migrate    # Deploy contracts to Ganache
```

**Frontend:**
```bash
cd frontend
npm start         # Start development server
npm run build     # Build for production
```

### Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild containers
docker-compose up -d --build

# Reset blockchain data
docker-compose down -v
docker-compose up -d
```

## Smart Contract Features

- User registration with wallet addresses
- Auction creation with minimum bid and buyout price
- Bidding system with automatic refunds
- Manual auction ending by seller
- Instant buyout functionality

## Contributing

Built by **Pawan, Yogeesh, Vishwas & Santosh**

## License

ISC

