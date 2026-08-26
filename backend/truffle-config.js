module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  contracts_build_directory : "./build/contracts",
  networks: {
    development: {
      host: process.env.GANACHE_HOST || "ganache",
      port: process.env.GANACHE_PORT || 8545,
      network_id: "*", // Match any network id
      gas: 6721975,
      gasPrice: 20000000000
    },
    local: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*" // Match any network id
    },
    develop: {
      port: 8545
    }
  },
  compilers: {
    solc: {
      version: "0.8.19", // Specify the Solidity version here
    }
  }
};
