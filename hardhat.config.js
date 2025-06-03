require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");

module.exports = {
  networks: {
    l1_scrollsdk: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: ["0x8c88b2cb3fca950a61b51c31c2d538f218a9aada0e187e324507d65b009a5f22"],
      chainId: 11155111,
      timeout: 300000
    },
    l2_scrollsdk: {
      url: "https://sepolia-rpc.scroll.io",
      accounts: ["0x8c88b2cb3fca950a61b51c31c2d538f218a9aada0e187e324507d65b009a5f22"],
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
      scrollSepolia: "JVKE13ZPNHB6M5YBDGD3INHSFZGV58ZNEX",
      sepolia: "GDJK4EW45TW1ZPBX1AJHAJQQTXTN3GWCFB"
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
