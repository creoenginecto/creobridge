import { HardhatUserConfig, task } from 'hardhat/config'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'
import 'hardhat-gas-reporter'
import 'solidity-coverage'
import 'hardhat-contract-sizer'
import 'hardhat-deploy'
import 'module-alias/register'

import '@/gotbit-tools/hardhat/init'
import { genNetworks, genCompilers } from '@/gotbit-tools/hardhat'

const DEPLOYER_TESTNET = '0x3BBE909b86520FD228cb9fc40CF8e15948391Ccb'
const FEE_WALLET_TESTNET = '0x3BBE909b86520FD228cb9fc40CF8e15948391Ccb'
const RELAYER_ROLE_TESTNET = '0x3BBE909b86520FD228cb9fc40CF8e15948391Ccb'

task('accounts', 'Prints the list of accounts', async (_, hre) => {
  const accounts = await hre.ethers.getSigners()
  for (const account of accounts) {
    console.log(account.address)
  }
})

const config: HardhatUserConfig = {
  solidity: {
    compilers: genCompilers(['0.8.18']),
  },
  namedAccounts: {
    deployer: {
      polygon_testnet: DEPLOYER_TESTNET,
      avax_testnet: DEPLOYER_TESTNET,
    },
    feeWallet: {
      polygon_testnet: FEE_WALLET_TESTNET,
      avax_testnet: FEE_WALLET_TESTNET,
    },
    relayer: {
      polygon_testnet: RELAYER_ROLE_TESTNET,
      avax_testnet: RELAYER_ROLE_TESTNET,
    },
  },
  networks: {
    hardhat: {
      tags: ['localhost'],
      deploy: ['deploy/localhost/'],

      // tags: ['fork'],
      // deploy: ['deploy/fork/'],
      // forking: {
      //   url: 'https://rpc.ankr.com/bsc',
      // },
    },
    ...genNetworks(),
    // place here any network you like (for overriding `genNetworks`)
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
  },
  mocha: {
    timeout: 200_000,
  },
}

export default config
