import { deployments, ethers } from 'hardhat'

import type { BridgeAssist, CreoEngine, Token } from '@/typechain'

export const useContracts = async () => {
  return {
    token: await ethers.getContract<Token>('Token'),
    creoEngine: await ethers.getContract<CreoEngine>('CreoEngine'),
    bridge: await ethers.getContract<BridgeAssist>('BridgeAssist'),
  }
}

export const deploy = deployments.createFixture(async () => {
  await deployments.fixture(undefined, { keepExistingDeployments: true })
  return useContracts()
})
