# MetaMask Setup Guide for Smart Auction Network

## Step 1: Install MetaMask
If you haven't already, install MetaMask browser extension from https://metamask.io/

## Step 2: Add Ganache Network to MetaMask

1. **Open MetaMask** and click on the network dropdown (usually shows "Ethereum Mainnet")

2. **Click "Add Network" or "Add a network manually"**

3. **Enter the following details:**
   - **Network Name:** `Ganache Local`
   - **New RPC URL:** `http://localhost:8545`
   - **Chain ID:** `1337`
   - **Currency Symbol:** `ETH`

4. **Click "Save"**

5. **Select the "Ganache Local" network** from the dropdown

## Step 3: Import a Test Account

You have 10 test accounts available, each with 100 ETH. Here's the first one:

1. **Click on your account icon** (top right in MetaMask)

2. **Click "Import Account"**

3. **Select "Private Key"** as the import method

4. **Paste this private key:**
   ```
   0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d
   ```

5. **Click "Import"**

6. You should now see **100 ETH** in your account!

## Step 4: Connect to the Application

1. **Open http://localhost:3000** in your browser

2. **Make sure MetaMask is:**
   - Unlocked
   - Connected to "Ganache Local" network
   - Has an imported account with ETH

3. **Enter a username** (e.g., "pawan")

4. **Click "Connect Wallet"**

5. **Approve the connection** in the MetaMask popup

6. **Start using the auction platform!** 🎉

## Troubleshooting

### "Failed to connect wallet"
- ✅ Make sure MetaMask is unlocked
- ✅ Verify you're on "Ganache Local" network (Chain ID: 1337)
- ✅ Check that the RPC URL is `http://localhost:8545`
- ✅ Try refreshing the page

### "Contract address not specified"
- ✅ Make sure all Docker containers are running: `docker ps`
- ✅ Restart containers: `docker-compose restart`

### "User rejected the request"
- ✅ Click "Connect Wallet" again
- ✅ Approve the MetaMask popup

### Transaction Fails
- ✅ Make sure you have enough ETH in your account
- ✅ Try resetting your MetaMask account: Settings → Advanced → Reset Account

## Additional Test Accounts

If you want to test with multiple users, here are more private keys:

**Account 2:**
```
0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1
```

**Account 3:**
```
0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c
```

Each account has **100 ETH** for testing!

## Quick Check

Run these commands to verify everything is working:

```bash
# Check if all containers are running
docker ps

# Should show 3 containers:
# - auction_ganache (port 8545)
# - auction_backend
# - auction_frontend (port 3000)

# View Ganache logs to see available accounts
docker logs auction_ganache
```

Happy Bidding! 🎉



