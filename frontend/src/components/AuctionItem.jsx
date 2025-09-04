import React from 'react';
import './AuctionItem.css';
import { useState, useEffect } from 'react';



function AuctionItem({ item, contract, accounts, web3, walletAddress, username }) {

  const [price, setPrice] = useState(web3.utils.fromWei(item.highestBid, 'ether'));
  const [isExpired, setExpired] = useState(item.ended);
  const [huser, sethuser] = useState(''); //

  const placeBid = async (itemId, bidAmount) => {
    bidAmount = prompt("Enter your bid amount in ETH:");
    if (bidAmount !== null) {
      await contract.methods.bid(itemId).send({
        from: accounts[0],
        value: web3.utils.toWei(bidAmount, 'ether')
      });
      setPrice(bidAmount)
    }
  };

  const buyout = async (itemId) => {
    const itemDetails = await contract.methods.items(itemId).call();
    await contract.methods.buyout(itemId).send({
      from: accounts[0],
      value: itemDetails.buyoutPrice
    });
  
    setExpired(true);
    console.log(itemDetails)
  };

  let initval = 0x0000000000000000000000000000000000000000 

  useEffect(() => {
    async function checkUserExists() {
      if (item.highestBidder != initval) {
        sethuser(await contract.methods.getUser(item.highestBidder).call())
      }
    }
    checkUserExists();
  }, [item.highestBidder]);



  let isEnded = "card " + (isExpired ? "disabled" : "");


  
  
    //  console.log('test',accounts)
  
  return (
    <div className={isEnded}>
      <img src={item.imageUrl} alt={item.name} />
      <h2>{item.name}</h2>
    
      { item.highestBidder == initval &&   <p className="bid-info">Minimum Bid Amount: {web3.utils.fromWei(item.minBid, 'ether')} ETH</p>  }      
      
      {   item.highestBidder != initval &&   !isExpired && <p className="bid-info">Current highest Bid  Price: {Number(price)} ETH</p>}

      {item.highestBidder != initval && <p className="buyout-info">{isExpired ? "Winner Address": "Current Highest bidder Address"} :  {(item.highestBidder)}</p>}

      { huser[0]  &&   <p className="buyout-info"> {isExpired ? "Winner": "Highest bidder"}   : {huser.username}</p>}

      <p className="buyout-info">Buyout Price: {web3.utils.fromWei(item.buyoutPrice, 'ether')} ETH</p>

      <p className='status-active'>{isExpired ? "EXPIRED" : "ACTIVE"}</p>
      {
        (item.seller != walletAddress) &&
        <>
          <button className="bid-button" onClick={() => placeBid(item.id)} disabled={isExpired}>Place Bid</button>
          <button className="buyout-button" onClick={() => buyout(item.id)} disabled={isExpired}>Buy Now</button>
        </>
      }
    </div>
  );
}

export default AuctionItem;
