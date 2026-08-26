import Web3 from 'web3';
import React, { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import Home from './pages/Home'
import Login from './pages/Login'
import DecentralizedAuctionContract from './contracts/DecentralizedAuction.json';

function App() {
  const [web3, setWeb3] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [contract, setContract] = useState(null);
  const [items, setItems] = useState([]);
  const [isOpenAddItemsPage, setisOpenAddItemsPage] = useState(false);
  const [isLoggedIn, setisLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [existingUser, setExistingUser] = useState(false);
  const [walletAddress, setwalletAddress] = useState('');
  const [toggleFeed, setToggleFeed] = useState(true);
  const [userItems, setuserItems] = useState([]);
  
  

  useEffect(() => {
    const initWeb3 = async () => {
      if (window.ethereum) {
        const web3Instance = new Web3(window.ethereum);
        setWeb3(web3Instance);
        
        try {
          // Request accounts silently if already connected, otherwise don't block
          const accounts = await web3Instance.eth.getAccounts();
          setAccounts(accounts);
        } catch (error) {
          console.log("Accounts not yet connected");
        }
        
        // Always load contract if web3 is available
        loadContract(web3Instance);
      } else {
        console.error('Please install MetaMask!');
      }
    };

    const loadContract = async (web3) => {
      try {
        // Get network ID and handle BigInt if necessary
        const networkIdRaw = await web3.eth.net.getId();
        const networkId = networkIdRaw.toString();
        
        console.log('Network ID:', networkId);
        console.log('Available networks in contract:', Object.keys(DecentralizedAuctionContract.networks));
        
        // Try to find network by ID (string or number/BigInt)
        let deployedNetwork = DecentralizedAuctionContract.networks[networkId];
        
        // Fallback: if current network is 1337 (Ganache Chain ID) but contract is on 5777 (Ganache Network ID)
        if (!deployedNetwork && networkId === '1337') {
             deployedNetwork = DecentralizedAuctionContract.networks['5777'];
        }
        
        if (!deployedNetwork || !deployedNetwork.address) {
          console.error('Contract not deployed to detected network.');
          console.error('Expected network ID:', networkId);
          console.error('Available networks:', Object.keys(DecentralizedAuctionContract.networks));
          return;
        }
        
        console.log('Contract address:', deployedNetwork.address);
        const contractInstance = new web3.eth.Contract(
          DecentralizedAuctionContract.abi,
          deployedNetwork.address,
        );

        setContract(contractInstance);
        const itemsCount = await contractInstance.methods.itemsCount().call();
        const items = [];
        for (let i = 0; i < itemsCount; i++) {
          const item = await contractInstance.methods.items(i).call();
          items.push(item);
        }
        // For now, if walletAddress is not set, we can't filter user items correctly yet, 
        // but we can still set all items
        if (walletAddress) {
          try {
            let _userItems = items.filter(x => x.seller === walletAddress);
            setuserItems(_userItems);
          } catch (error) {
            console.log("Unable to Fetch User Items", error);
          }
        }
        setItems(items);
      } catch (error) {
        console.error('Error loading contract:', error);
      }
    };
    initWeb3();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenAddItemsPage,walletAddress,existingUser,toggleFeed,isLoggedIn]);

  const toggleAddItemsPage = () => {
      setisOpenAddItemsPage(prevState => !prevState);
  }
  const toggleisLoggedIn = () => {
    setisLoggedIn(true);
  }
  const openUserAuctions = () => {
    setToggleFeed(prevState => !prevState);
  }
  // const withdrawRefunds = async () => {
  //   try{
  //     const success = await contract.methods.withdraw().send();
  //     console.log("withdrawRefunds()")
  //     console.log(Number(success))
  //     alert("Withdraw Successful")
  //   }catch(error){
  //     console.log(error);
  //     //console.log(success)
  //     alert("Withdraw Failed")
  //   }
  //   //alert(success ? "Withdraw Successful" : "Withdraw Failed");
  //   //console.log( success ? "Withdraw Successful" : "Withdraw Failed");
  // }
  const endAuction = async (id) => {
      try {
          // Call the endAuction method in the smart contract
          const success = await contract.methods.manualEndAuction(id).send({
            from: walletAddress
          });
  
          // console.log(`Wallet Address: ${walletAddress}`)
          // console.log(`endAuction(${id})`)
          // console.log(success)
          //console.log(success.data.message)
          if (success) {
              // Update the local state
              setItems((prevItems) =>
                  prevItems.map((item) =>
                      item.id === id ? { ...item, ended: true } : item
                  )
              );
          }
      } catch (error) {
          console.warn('Error ending the auction:', error);
      }
  };
  
  return (
    <>
      <Toaster position="top-center" />
      {!isLoggedIn ? 
        <Login 
          contract={contract} 
          onLogin={toggleisLoggedIn} 
          username = {username} 
          setUsername = {setUsername} 
          existingUser = {existingUser} 
          setExistingUser = {setExistingUser}
          setwalletAddress = {setwalletAddress}
        />
        : 
        <Home 
          items = {items} 
          userItems = {userItems}
          contract = {contract} 
          accounts = {accounts} 
          web3 = {web3} 
          toggleAddItemsPage = {toggleAddItemsPage} 
          isOpenAddItemsPage = {isOpenAddItemsPage}
          username = {username}
          walletAddress = {walletAddress}
          openUserAuctions = {openUserAuctions}
          toggleFeed = {toggleFeed}
          endAuction = {endAuction}
        />
      }
    </>
  );  
}

export default App;
