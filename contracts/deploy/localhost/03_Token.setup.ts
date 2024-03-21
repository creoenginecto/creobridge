import { ethers } from 'hardhat'

import type { BridgeAssist, Token } from '@/typechain'

import { safeRead, safeWrite, setup } from '@/gotbit-tools/hardhat'

const func = setup('Token', async () => {
  const [deployer] = await ethers.getSigners()
  const token = await ethers.getContract<Token>('Token')
  const bridgeAssist = await ethers.getContract<BridgeAssist>('BridgeAssist')

  await safeWrite(
    token.connect(deployer).transfer(bridgeAssist.address, '500_000'.toBigNumber())
  )
})
export default func

func.tags = ['Token.setup']
func.dependencies = ['Token.deploy', 'BridgeAssist.deploy']
func.runAtTheEnd = true
