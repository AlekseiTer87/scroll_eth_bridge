require("@nomiclabs/hardhat-waffle");

module.exports = {
  networks: {
    l1_scrollsdk: {
      url: "http://l1-devnet.scrollsdk",
      accounts: ["ваш приватный ключ в формате 0x..."],
      chainId: 111111
    },
    l2_scrollsdk: {
      url: "http://l2-rpc.scrollsdk",
      accounts: ["ваш приватный ключ в формате 0x..."],
      chainId: 221122
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
  ]
}; 