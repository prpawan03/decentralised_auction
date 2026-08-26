import AuctionItem from '../components/AuctionItem';
import NavBar from '../components/NavBar';
import AddItems from '../components/AddItems';
import AuctionItemLandscape from '../components/AuctionItemLandscape';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';

const Home = ({ items, userItems, contract, accounts, web3, isOpenAddItemsPage, toggleAddItemsPage, username, walletAddress, openUserAuctions, toggleFeed, endAuction }) => {
      
    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500">
            <NavBar 
                username={username} 
                walletAddress={walletAddress}
                openUserAuctions={openUserAuctions}
            />
            
            {isOpenAddItemsPage ? (
                <div className="max-w-2xl mx-auto p-6">
                    <AddItems 
                        contract={contract} 
                        accounts={accounts} 
                        web3={web3} 
                        back={toggleAddItemsPage} 
                        walletAddress={walletAddress}
                    />
                </div>
            ) : (
                <div className="relative">
                    {/* Floating Add Button */}
                    <button 
                        onClick={toggleAddItemsPage}
                        className="fixed bottom-8 right-8 z-40 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white font-semibold px-6 py-4 rounded-full shadow-glow hover:shadow-glow-lg transition-all duration-200 active:scale-95 flex items-center gap-3 group"
                    >
                        <FontAwesomeIcon 
                            icon={faPlus} 
                            className="text-xl group-hover:rotate-90 transition-transform duration-200" 
                        />
                        <span className="hidden sm:inline">Add Item</span>
                    </button>

                    {!toggleFeed ? (
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                            <div className="mb-6">
                                <h2 className="text-3xl font-display font-bold text-white mb-2">
                                    Your Auctions
                                </h2>
                                <p className="text-white/80">
                                    Manage and track your listed items
                                </p>
                            </div>
                            
                            {userItems.length === 0 ? (
                                <div className="card-glass p-12 text-center">
                                    <p className="text-white/70 text-lg">
                                        You haven't created any auctions yet
                                    </p>
                                    <button 
                                        onClick={toggleAddItemsPage}
                                        className="mt-4 btn-primary"
                                    >
                                        Create Your First Auction
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {userItems.map((item, index) => (
                                        <AuctionItemLandscape 
                                            key={index}
                                            web3={web3} 
                                            item={item} 
                                            endAuction={endAuction} 
                                            contract={contract}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                            <div className="mb-6">
                                <h2 className="text-3xl font-display font-bold text-white mb-2">
                                    Live Auctions
                                </h2>
                                <p className="text-white/80">
                                    Browse and bid on active auctions
                                </p>
                            </div>

                            {items.length === 0 ? (
                                <div className="card-glass p-12 text-center">
                                    <p className="text-white/70 text-lg">
                                        No auctions available at the moment
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {items.map((item, index) => (
                                        <AuctionItem 
                                            key={index} 
                                            item={item} 
                                            contract={contract} 
                                            accounts={accounts} 
                                            web3={web3} 
                                            walletAddress={walletAddress}
                                            username={username}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default Home;
