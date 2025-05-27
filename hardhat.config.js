require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");

module.exports = {
  networks: {
    l1_scrollsdk: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: ["0x_your_Private_Key"],
      chainId: 11155111,
      timeout: 300000
    },
    l2_scrollsdk: {
      url: "https://scroll-sepolia-rpc.publicnode.com",
      accounts: ["0x_your_Private_Key"],
      chainId: 534351,
      timeout: 300000
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.8.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ] 
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  // Игнорируем проблемные пакеты
  ignorableContractSources: [
    "@ensdomains/ens/contracts/Deed.sol",
    "node_modules/@ensdomains/"
  ],
  etherscan: {
    apiKey: {
      scrollSepolia: "Your_API_Key_scrollSepoliaScan",
      sepolia: "Your_API_Key_sepoliaScan"
    },
    customChains: [
      {
        network: "scrollSepolia",
        chainId: 534351,
        urls: {
          apiURL: "https://api-sepolia.scrollscan.com/api",
          browserURL: "https://sepolia.scrollscan.com/"
        }
      }
    ]
  }
}; 
