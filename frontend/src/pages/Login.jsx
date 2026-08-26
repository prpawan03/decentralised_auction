import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWallet, faUser, faCoins } from '@fortawesome/free-solid-svg-icons';

const Login = ({ contract, onLogin, username, setUsername, existingUser, setExistingUser, setwalletAddress }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        async function checkUserExists() {
            if (!window.ethereum) {
                setError('Please install MetaMask!');
                return;
            }
            if (!contract) {
                return;
            }
            
            try {
                const account = await window.ethereum.request({ method: 'eth_requestAccounts' });
                const isRegistered = await contract.methods.getUser(account[0]).call();
                if (isRegistered) {
                    setUsername(isRegistered.username)
                    setExistingUser(true);
                    onLogin();
                } else {
                    setExistingUser(false);
                }
                setwalletAddress(isRegistered.walletAddress);
            } catch (error) {
                if (error.code === 4001) {
                    setError('Please connect to MetaMask.');
                } else if (error.message.includes('Internal JSON-RPC error')) {
                    setError('A JSON-RPC error occurred. Please try again.');
                }
            }
        }
    
        checkUserExists();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract]);

    const connectWallet = async () => {
        if (!window.ethereum) {
            setError('Please install MetaMask!');
            return;
        }
        
        if (!contract) {
            setError('Smart contract is loading... Please wait and try again.');
            return;
        }
        
        if (!existingUser && !username.trim()) {
            setError('Please enter a username');
            return;
        }
        
        setLoading(true);
        setError('');
        
        try {
            // Check if MetaMask is on the correct network
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            if (chainId !== '0x539') { // 0x539 = 1337 in hex
                setError('Please switch MetaMask to Ganache network (Chain ID: 1337)');
                setLoading(false);
                return;
            }
            
            const account = await window.ethereum.request({ method: 'eth_requestAccounts' });
            
            if (!account || account.length === 0) {
                setError('No accounts found. Please unlock MetaMask.');
                setLoading(false);
                return;
            }
            
            if (!existingUser) {
                await contract.methods.registerUser(username).send({ from: account[0] });
            }
            onLogin();
        } catch (error) {
            console.error('Wallet connection error:', error);
            
            if (error.code === 4001) {
                setError('Connection rejected. Please approve the MetaMask request.');
            } else if (error.message.includes('User denied')) {
                setError('Transaction rejected. Please approve in MetaMask.');
            } else if (error.message.includes('network')) {
                setError('Network error. Make sure you are on the correct network.');
            } else {
                setError(`Failed to connect: ${error.message || 'Unknown error'}`);
            }
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-20 w-72 h-72 bg-primary-500/20 rounded-full blur-3xl animate-pulse-slow"></div>
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-secondary-500/20 rounded-full blur-3xl animate-pulse-slow" style={{animationDelay: '1s'}}></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-accent-500/10 rounded-full blur-3xl animate-pulse-slow" style={{animationDelay: '2s'}}></div>
            </div>

            <div className="w-full max-w-md relative z-10">
                {/* Logo/Header Section */}
                <div className="text-center mb-8 animate-float">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-full mb-4 shadow-glow">
                        <FontAwesomeIcon icon={faCoins} className="text-white text-4xl" />
                    </div>
                    <h1 className="text-4xl font-display font-bold text-white mb-2 drop-shadow-lg">
                        Smart Auction Network
                    </h1>
                    <p className="text-white/80 text-sm font-medium">
                        Decentralized auction platform powered by Ethereum
                    </p>
                </div>

                {/* Main Card */}
                <div className="card-glass p-8 shadow-2xl transition-all duration-300 hover:shadow-glow-lg">
                    {!existingUser ? (
                        <>
                            <h2 className="text-2xl font-display font-semibold text-white mb-2 text-center">
                                Create Your Account
                            </h2>
                            <p className="text-white/70 text-sm mb-6 text-center">
                                Register to start bidding and creating auctions
                            </p>
                            
                            <div className="mb-6">
                                <label className="block text-white/90 text-sm font-medium mb-2">
                                    <FontAwesomeIcon icon={faUser} className="mr-2" />
                                    Username
                                </label>
                                <input 
                                    type="text"
                                    value={username} 
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="input-field"
                                    placeholder="Enter your username"
                                    disabled={loading}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className="text-2xl font-display font-semibold text-white mb-2 text-center">
                                Welcome Back!
                            </h2>
                            <p className="text-white/70 text-sm mb-6 text-center">
                                Connect your wallet to continue
                            </p>
                        </>
                    )}

                    {error && (
                        <div className="mb-4 p-3 bg-accent-500/20 border border-accent-500/50 rounded-lg text-white text-sm">
                            {error}
                        </div>
                    )}

                    <button 
                        onClick={connectWallet}
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-glow active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    >
                        <FontAwesomeIcon icon={faWallet} className="text-xl" />
                        <span className="text-lg">
                            {loading ? 'Connecting...' : 'Connect Wallet'}
                        </span>
                    </button>

                    <div className="mt-6 text-center text-white/60 text-xs space-y-1">
                        <p>Make sure MetaMask is installed and unlocked</p>
                        <p>Network: Ganache Local (Chain ID: 1337)</p>
                        <p>RPC URL: http://localhost:8545</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-white/70 text-sm font-medium">
                        Built by Pawan, Yogeesh, Vishwas & Santosh
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
