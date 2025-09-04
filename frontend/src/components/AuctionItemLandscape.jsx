import React, { useEffect, useState } from 'react';
import './AuctionItemLandscape.css';

function AuctionItemLandscape({ web3, item, endAuction ,contract}) {
    const { imageUrl, name, highestBid, buyoutPrice, ended } = item;
    const  [huser,sethuser] = useState('')
    let initval = 0x0000000000000000000000000000000000000000

    useEffect(() => {
        async function checkUserExists() {
          if (item.highestBidder != initval) {
            sethuser(await contract.methods.getUser(item.highestBidder).call())
          }
        }
        checkUserExists();
      }, [item.highestBidder]);
      
    return (
        <div className="auction-item-landscape">
            <img src={imageUrl} alt={name} className="auction-item-landscape-image" />
            <div className="auction-item-landscape-info">
                <h2>{name}</h2>
                { item.highestBidder == initval &&   <p className="paid">Minimum Bid: {web3.utils.fromWei(item.minBid, 'ether')} ETH</p>  }      
           
               { item.highestBidder != initval && <p>  {ended ? "paid": "Current Bid"} : {Number(web3.utils.fromWei(highestBid,'ether'))} ETH </p>} 
                {item.highestBidder != initval && <p >{ended ? "Winner Address": "Current Highest bidder Address"} :  {(item.highestBidder)}</p>}
                { huser[0]  &&   <p > {ended ? "Winner": "Current Highest bidder"}   : {huser.username}</p>}

                <p>Buyout price: {Number(web3.utils.fromWei(buyoutPrice, 'ether'))} ETH</p>
                <p>Status: {ended ? "Ended": "Active"}</p>
                { !ended &&
                    <button className="end-auction-button" onClick={() => endAuction(item.id)}>End Auction</button>
                }
            </div>
        </div>
    );
}

export default AuctionItemLandscape;
