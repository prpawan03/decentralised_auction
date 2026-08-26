import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCircle, faGavel, faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';

const NavBar = ({ username, walletAddress, openUserAuctions }) => {
    const [copied, setCopied] = useState(false);

    const truncateAddress = (address) => {
        if (!address) return '';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(walletAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <nav className="sticky top-0 z-50 backdrop-blur-lg bg-white/10 border-b border-white/20 shadow-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-20">
                    {/* Left Section - Your Auctions Button */}
                    <div className="flex items-center">
                        <button 
                            onClick={openUserAuctions}
                            className="flex items-center gap-3 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 text-white border border-white/20 hover:border-white/30 group"
                        >
                            <FontAwesomeIcon 
                                icon={faGavel} 
                                className="text-xl group-hover:rotate-12 transition-transform duration-200" 
                            />
                            <span className="font-medium hidden sm:inline">Your Auctions</span>
                        </button>
                    </div>

                    {/* Center Section - Title */}
                    <div className="absolute left-1/2 transform -translate-x-1/2 text-center hidden md:block">
                        <h1 className="text-2xl font-display font-bold text-white drop-shadow-lg">
                            Smart Auction Network
                        </h1>
                        <p className="text-xs text-white/70 font-medium mt-0.5">
                            Powered by Ethereum
                        </p>
                    </div>

                    {/* Right Section - User Info */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 px-4 py-2 bg-white/10 rounded-lg border border-white/20">
                            <div className="flex items-center gap-3">
                                <div className="hidden sm:block text-right">
                                    <p className="text-white font-semibold text-sm">{username}</p>
                                    <div className="flex items-center gap-2 text-white/70 text-xs">
                                        <span className="font-mono">{truncateAddress(walletAddress)}</span>
                                        <button
                                            onClick={copyToClipboard}
                                            className="hover:text-white transition-colors duration-200"
                                            title="Copy address"
                                        >
                                            <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-xs" />
                                        </button>
                                    </div>
                                </div>
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center shadow-lg">
                                    <FontAwesomeIcon icon={faUserCircle} className="text-white text-2xl" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mobile Title */}
                <div className="md:hidden pb-4 text-center">
                    <h1 className="text-xl font-display font-bold text-white drop-shadow-lg">
                        Smart Auction Network
                    </h1>
                </div>
            </div>
        </nav>
    );
}

export default NavBar;
