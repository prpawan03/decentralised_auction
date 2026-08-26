# Setup Guide - Smart Auction Network

## Prerequisites Installation

### 1. Install Docker Desktop

**Windows:**
- Download from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
- Run the installer and follow the instructions
- Restart your computer if prompted

**macOS:**
- Download from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
- Open the .dmg file and drag Docker to Applications
- Launch Docker from Applications

**Linux:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Install MetaMask

- Visit [https://metamask.io/](https://metamask.io/)
- Click "Download" and install the browser extension
- Create a new wallet or import an existing one
- Save your seed phrase securely

## Running the Application

### Option 1: Using Start Scripts (Recommended)

**Windows:**
```bash
start.bat
```

**macOS/Linux:**
```bash
chmod +x start.sh
./start.sh
```

### Option 2: Manual Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## MetaMask Configuration

### Add Ganache Network

1. Open MetaMask
2. Click the network dropdown (top center)
3. Click "Add Network" → "Add a network manually"
4. Enter the following details:
   - **Network Name:** Ganache Local
   - **RPC URL:** http://localhost:8545
   - **Chain ID:** 1337
   - **Currency Symbol:** ETH

### Import a Test Account

1. View Ganache accounts:
```bash
docker logs auction_ganache
```

2. Copy any private key from the output (they start with `0x...`)
3. In MetaMask:
   - Click the account icon (top right)
   - Click "Import Account"
   - Paste the private key
   - Click "Import"

You now have 100 ETH to test with!

## Using the Application

1. **Open the app:** Navigate to `http://localhost:3000`

2. **Register:**
   - Enter a username
   - Click "Connect Wallet"
   - Approve the MetaMask connection

3. **Create an Auction:**
   - Click the "Add Item" button
   - Fill in item details
   - Set minimum bid and buyout price
   - Submit the form

4. **Place Bids:**
   - Browse live auctions
   - Click "Place Bid" on any item
   - Enter your bid amount (must be higher than current bid)
   - Confirm in MetaMask

5. **Buy Now:**
   - Click "Buy Now" to purchase at buyout price
   - Confirm the transaction in MetaMask

6. **Manage Your Auctions:**
   - Click "Your Auctions" in the navbar
   - View all your listed items
   - End auctions when ready

## Troubleshooting

### Services won't start
```bash
# Reset everything
docker-compose down -v
docker-compose up -d --build
```

### MetaMask transaction fails
- Make sure you're connected to the Ganache network
- Check that you have enough ETH
- Try resetting your MetaMask account:
  - Settings → Advanced → Reset Account

### Contract not found error
```bash
# Redeploy contracts
docker-compose restart backend
```

### Frontend not loading
```bash
# Check frontend logs
docker logs auction_frontend

# Rebuild frontend
docker-compose up -d --build frontend
```

## Development Tips

### Hot Reload
- Frontend changes auto-reload
- Contract changes require redeployment

### View Blockchain State
```bash
# Connect to Ganache
docker logs auction_ganache
```

### Reset Blockchain
```bash
# This will clear all data and redeploy contracts
docker-compose down -v
docker-compose up -d
```

## Support

For issues or questions, check:
- Docker logs: `docker-compose logs -f`
- Browser console (F12)
- MetaMask activity tab

Built with ❤️ by Pawan, Yogeesh, Vishwas & Santosh

