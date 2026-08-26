import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCoins, faGavel, faBolt, faUser } from '@fortawesome/free-solid-svg-icons';
import toast, { Toaster } from 'react-hot-toast';

function AuctionItem({ item, contract, accounts, web3, walletAddress, username }) {
  const [price, setPrice] = useState(web3.utils.fromWei(item.highestBid, 'ether'));
  const [isExpired, setExpired] = useState(item.ended);
  const [huser, sethuser] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const placeBid = async (itemId, bidAmount) => {
    const bidAmountStr = prompt("Enter your bid amount in ETH:");
    if (bidAmountStr !== null && bidAmountStr.trim() !== '') {
      setIsLoading(true);
      try {
        await contract.methods.bid(itemId).send({
          from: accounts[0],
          value: web3.utils.toWei(bidAmountStr, 'ether')
        });
        setPrice(bidAmountStr);
        toast.success('Bid placed successfully!');
      } catch (error) {
        toast.error('Failed to place bid. Please try again.');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const buyout = async (itemId) => {
    setIsLoading(true);
    try {
      const itemDetails = await contract.methods.items(itemId).call();
      await contract.methods.buyout(itemId).send({
        from: accounts[0],
        value: itemDetails.buyoutPrice
      });
      setExpired(true);
      toast.success('Item purchased successfully!');
    } catch (error) {
      toast.error('Failed to purchase item. Please try again.');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  let initval = '0x0000000000000000000000000000000000000000';

  useEffect(() => {
    async function checkUserExists() {
      if (item.highestBidder !== initval) {
        try {
          const user = await contract.methods.getUser(item.highestBidder).call();
          sethuser(user);
        } catch (error) {
          console.error('Error fetching user:', error);
        }
      }
    }
    checkUserExists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.highestBidder]);

  return (
    <>
      <Toaster position="top-center" />
      <div className={`card-glass overflow-hidden transition-all duration-300 hover:scale-105 ${isExpired ? 'opacity-75' : 'hover:shadow-glow'}`}>
        {/* Status Badge */}
        <div className="absolute top-4 right-4 z-10">
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
            isExpired 
              ? 'bg-gray-500/80 text-white' 
              : 'bg-gradient-to-r from-green-500 to-green-600 text-white animate-pulse'
          }`}>
            {isExpired ? 'EXPIRED' : 'ACTIVE'}
          </span>
        </div>

        {/* Image Section */}
        <div className="relative h-64 overflow-hidden bg-gray-900">
          <img 
            src={item.imageUrl} 
            alt={item.name} 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        </div>

        {/* Content Section */}
        <div className="p-6 space-y-4">
          {/* Title */}
          <h3 className="text-xl font-display font-bold text-white truncate">
            {item.name}
          </h3>

          {/* Bid Information */}
          <div className="space-y-2">
            {item.highestBidder === initval ? (
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                <span className="text-white/70 text-sm font-medium">Minimum Bid</span>
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faCoins} className="text-yellow-400" />
                  <span className="text-white font-bold">
                    {web3.utils.fromWei(item.minBid, 'ether')} ETH
                  </span>
                </div>
              </div>
            ) : !isExpired && (
              <div className="flex items-center justify-between p-3 bg-primary-500/20 rounded-lg border border-primary-500/30">
                <span className="text-white/90 text-sm font-medium">Current Highest Bid</span>
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faCoins} className="text-yellow-400" />
                  <span className="text-white font-bold text-lg">
                    {Number(price)} ETH
                  </span>
                </div>
              </div>
            )}

            {/* Highest Bidder Info */}
            {item.highestBidder !== initval && (
              <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                <p className="text-white/70 text-xs mb-1">
                  {isExpired ? 'Winner' : 'Highest Bidder'}
                </p>
                {huser.username && (
                  <div className="flex items-center gap-2 text-white">
                    <FontAwesomeIcon icon={faUser} className="text-sm" />
                    <span className="font-medium">{huser.username}</span>
                  </div>
                )}
                <p className="text-white/50 text-xs font-mono mt-1">
                  {item.highestBidder.substring(0, 10)}...{item.highestBidder.substring(item.highestBidder.length - 8)}
                </p>
              </div>
            )}

            {/* Buyout Price */}
            <div className="flex items-center justify-between p-3 bg-accent-500/10 rounded-lg border border-accent-500/20">
              <span className="text-white/70 text-sm font-medium">Buyout Price</span>
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faCoins} className="text-accent-400" />
                <span className="text-white font-bold">
                  {web3.utils.fromWei(item.buyoutPrice, 'ether')} ETH
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {item.seller !== walletAddress && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button 
                onClick={() => placeBid(item.id)}
                disabled={isExpired || isLoading}
                className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-glow active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <FontAwesomeIcon icon={faGavel} />
                <span>Place Bid</span>
              </button>
              <button 
                onClick={() => buyout(item.id)}
                disabled={isExpired || isLoading}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <FontAwesomeIcon icon={faBolt} />
                <span>Buy Now</span>
              </button>
            </div>
          )}

          {item.seller === walletAddress && (
            <div className="p-3 bg-secondary-500/20 rounded-lg border border-secondary-500/30 text-center">
              <p className="text-white/90 text-sm font-medium">
                This is your auction
              </p>
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white"></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default AuctionItem;
