import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCoins, faCheckCircle, faUser } from '@fortawesome/free-solid-svg-icons';
import toast, { Toaster } from 'react-hot-toast';

function AuctionItemLandscape({ item, contract, web3, endAuction }) {
  const [isExpired, setExpired] = useState(item.ended);
  const [huser, sethuser] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleEndAuction = async () => {
    if (window.confirm('Are you sure you want to end this auction?')) {
      setIsLoading(true);
      try {
        await endAuction(item.id);
        setExpired(true);
        toast.success('Auction ended successfully!');
      } catch (error) {
        toast.error('Failed to end auction. Please try again.');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
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
      <div className={`card-glass overflow-hidden transition-all duration-300 hover:scale-[1.02] ${isExpired ? 'opacity-75' : ''}`}>
        <div className="flex flex-col md:flex-row gap-6 p-6">
          {/* Image Section */}
          <div className="relative w-full md:w-64 h-48 flex-shrink-0">
            <img 
              src={item.imageUrl} 
              alt={item.name} 
              className="w-full h-full object-cover rounded-lg"
            />
            <div className="absolute top-3 right-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                isExpired 
                  ? 'bg-gray-500/80 text-white' 
                  : 'bg-gradient-to-r from-green-500 to-green-600 text-white animate-pulse'
              }`}>
                {isExpired ? 'ENDED' : 'ACTIVE'}
              </span>
            </div>
          </div>

          {/* Content Section */}
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h3 className="text-2xl font-display font-bold text-white mb-4">
                {item.name}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Minimum Bid */}
                <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-white/70 text-xs mb-1">Minimum Bid</p>
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faCoins} className="text-yellow-400" />
                    <span className="text-white font-bold">
                      {web3.utils.fromWei(item.minBid, 'ether')} ETH
                    </span>
                  </div>
                </div>

                {/* Current Bid */}
                <div className="p-3 bg-primary-500/20 rounded-lg border border-primary-500/30">
                  <p className="text-white/70 text-xs mb-1">
                    {item.highestBidder === initval ? 'No Bids Yet' : 'Current Bid'}
                  </p>
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faCoins} className="text-yellow-400" />
                    <span className="text-white font-bold">
                      {item.highestBidder === initval 
                        ? '0 ETH' 
                        : `${web3.utils.fromWei(item.highestBid, 'ether')} ETH`
                      }
                    </span>
                  </div>
                </div>

                {/* Buyout Price */}
                <div className="p-3 bg-accent-500/10 rounded-lg border border-accent-500/20">
                  <p className="text-white/70 text-xs mb-1">Buyout Price</p>
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faCoins} className="text-accent-400" />
                    <span className="text-white font-bold">
                      {web3.utils.fromWei(item.buyoutPrice, 'ether')} ETH
                    </span>
                  </div>
                </div>
              </div>

              {/* Highest Bidder Info */}
              {item.highestBidder !== initval && (
                <div className="p-4 bg-white/5 rounded-lg border border-white/10 mb-4">
                  <p className="text-white/70 text-xs mb-2">
                    {isExpired ? '🏆 Winner' : '👑 Current Highest Bidder'}
                  </p>
                  {huser.username && (
                    <div className="flex items-center gap-2 text-white mb-1">
                      <FontAwesomeIcon icon={faUser} />
                      <span className="font-medium text-lg">{huser.username}</span>
                    </div>
                  )}
                  <p className="text-white/50 text-xs font-mono">
                    {item.highestBidder}
                  </p>
                </div>
              )}
            </div>

            {/* Action Button */}
            <div className="flex gap-3">
              {!isExpired && item.highestBidder !== initval && (
                <button 
                  onClick={handleEndAuction}
                  disabled={isLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-accent-600 hover:bg-accent-700 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FontAwesomeIcon icon={faCheckCircle} />
                  <span>End Auction</span>
                </button>
              )}
              {!isExpired && item.highestBidder === initval && (
                <div className="flex-1 p-3 bg-yellow-500/20 rounded-lg border border-yellow-500/30 text-center">
                  <p className="text-yellow-200 text-sm font-medium">
                    Waiting for bids...
                  </p>
                </div>
              )}
              {isExpired && (
                <div className="flex-1 p-3 bg-green-500/20 rounded-lg border border-green-500/30 text-center">
                  <p className="text-green-200 text-sm font-medium">
                    ✓ Auction Completed
                  </p>
                </div>
              )}
            </div>
          </div>

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

export default AuctionItemLandscape;
