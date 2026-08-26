import React, { useState } from 'react';
import Web3 from 'web3';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faImage, faCoins, faBolt, faTag } from '@fortawesome/free-solid-svg-icons';
import toast, { Toaster } from 'react-hot-toast';

const imageOptions = [
  { label: "Vintage Phone", url: "https://m.media-amazon.com/images/I/71tQC-279uL.jpg" },
  { label: "Record Player", url: "https://ii1.pepperfry.com/media/catalog/product/g/o/494x544/gold-brass-and-wood-embossed-horn-and-gramophone-by-exim-decor-gold-brass-and-wood-embossed-horn-and-fjizt5.jpg" },
  { label: "Aladdin Movie Prop", url: "https://multiwood.com.pk/cdn/shop/products/Picsart_22-10-23_03-53-33-812_1000x1000.jpg?v=1666479726" },
  { label: "Sword", url: "https://www.swordsantiqueweapons.com/images/s2331b.jpg" },
  { label: "Flintlock", url: "https://www.hemswell-antiques.com/uploads/media/news/0001/95/thumb_94739_news_wide.jpeg" },
  { label: "James Bond's DB5", url: "https://www.007.com/wp-content/uploads/2022/08/LCC-LS.jpg" },
  { label: "Commodore PET", url: "https://i.redd.it/om995fq8j8ua1.jpg" },
  { label: "HP Palmtop", url: "https://i.pcmag.com/imagery/lineupitems/06sRck1AimbfOxWwRYvEBqX.fit_lim.size_1050x578.v1569508748.jpg" }
];

const AddItems = ({ web3, accounts, contract, back }) => {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  const [minBid, setMinBid] = useState('');
  const [buyoutPrice, setBuyoutPrice] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!web3) {
      toast.error('Web3 is not initialized. Ensure MetaMask is connected.');
      return;
    }

    const finalImageUrl = useCustomUrl ? customImageUrl : imageUrl;

    if (!finalImageUrl) {
      toast.error('Please provide an image URL.');
      return;
    }

    if (parseFloat(minBid) >= parseFloat(buyoutPrice)) {
      toast.error('Buyout price must be greater than minimum bid.');
      return;
    }

    setIsLoading(true);

    try {
      const biddingTimeInSeconds = 100 * 60;

      await contract.methods.addItem(
        name,
        finalImageUrl,
        Web3.utils.toWei(minBid, 'ether'),
        Web3.utils.toWei(buyoutPrice, 'ether'),
        biddingTimeInSeconds
      ).send({ from: accounts[0] });

      toast.success('Item added successfully!');
      
      // Reset form
      setName('');
      setImageUrl('');
      setCustomImageUrl('');
      setUseCustomUrl(false);
      setMinBid('');
      setBuyoutPrice('');
      
      setTimeout(() => {
        back();
      }, 1500);
    } catch (error) {
      toast.error('Failed to add item. ' + (error.message || 'Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const selectedImage = useCustomUrl ? customImageUrl : imageUrl;

  return (
    <>
      <Toaster position="top-center" />
      <div className="min-h-[calc(100vh-5rem)] py-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <button 
              onClick={back}
              className="flex items-center gap-2 text-white/80 hover:text-white transition-colors duration-200 mb-4"
            >
              <FontAwesomeIcon icon={faArrowLeft} />
              <span>Back to Auctions</span>
            </button>
            <h2 className="text-3xl font-display font-bold text-white mb-2">
              Create New Auction
            </h2>
            <p className="text-white/80">
              List your item and start receiving bids
            </p>
          </div>

          <div className="card-glass p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Item Name */}
              <div>
                <label className="block text-white/90 text-sm font-medium mb-2">
                  <FontAwesomeIcon icon={faTag} className="mr-2" />
                  Item Name
                </label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  placeholder="e.g., Vintage Rolex Watch"
                  required 
                  disabled={isLoading}
                />
              </div>

              {/* Image Selection */}
              <div>
                <label className="block text-white/90 text-sm font-medium mb-2">
                  <FontAwesomeIcon icon={faImage} className="mr-2" />
                  Item Image
                </label>
                
                {!useCustomUrl ? (
                  <div className="space-y-3">
                    <select 
                      value={imageUrl} 
                      onChange={(e) => setImageUrl(e.target.value)}
                      className="input-field"
                      required
                      disabled={isLoading}
                    >
                      <option value="">Select an Image</option>
                      {imageOptions.map((option, index) => (
                        <option key={index} value={option.url}>{option.label}</option>
                      ))}
                    </select>
                    <button 
                      type="button" 
                      onClick={() => setUseCustomUrl(true)}
                      className="text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors duration-200"
                      disabled={isLoading}
                    >
                      Or use custom image URL →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input 
                      type="url" 
                      value={customImageUrl} 
                      onChange={(e) => setCustomImageUrl(e.target.value)}
                      className="input-field"
                      placeholder="https://example.com/image.jpg"
                      required
                      disabled={isLoading}
                    />
                    <button 
                      type="button" 
                      onClick={() => setUseCustomUrl(false)}
                      className="text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors duration-200"
                      disabled={isLoading}
                    >
                      ← Back to predefined images
                    </button>
                  </div>
                )}

                {/* Image Preview */}
                {selectedImage && (
                  <div className="mt-4 p-4 bg-white/5 rounded-lg border border-white/10">
                    <p className="text-white/70 text-xs mb-2">Preview:</p>
                    <img 
                      src={selectedImage} 
                      alt="Preview" 
                      className="w-full h-48 object-cover rounded-lg"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        toast.error('Invalid image URL');
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Pricing Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Minimum Bid */}
                <div>
                  <label className="block text-white/90 text-sm font-medium mb-2">
                    <FontAwesomeIcon icon={faCoins} className="mr-2" />
                    Minimum Bid (ETH)
                  </label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={minBid} 
                    onChange={(e) => setMinBid(e.target.value)}
                    className="input-field"
                    placeholder="0.1"
                    required
                    disabled={isLoading}
                  />
                  <p className="text-white/50 text-xs mt-1">
                    Starting bid amount
                  </p>
                </div>

                {/* Buyout Price */}
                <div>
                  <label className="block text-white/90 text-sm font-medium mb-2">
                    <FontAwesomeIcon icon={faBolt} className="mr-2" />
                    Buyout Price (ETH)
                  </label>
                  <input 
                    type="number" 
                    step="0.001"
                    value={buyoutPrice} 
                    onChange={(e) => setBuyoutPrice(e.target.value)}
                    className="input-field"
                    placeholder="1.0"
                    required
                    disabled={isLoading}
                  />
                  <p className="text-white/50 text-xs mt-1">
                    Instant purchase price
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={back}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 border border-white/20 hover:border-white/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-glow active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-white"></div>
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Auction</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default AddItems;
