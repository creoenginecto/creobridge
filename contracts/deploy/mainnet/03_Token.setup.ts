import { ethers, getChainId } from 'hardhat'

import type { BridgeAssist, Token } from '@/typechain'

import { safeWrite, setup } from '@/gotbit-tools/hardhat'

const func = setup('Token', async () => {
  // The token is already deployed on BSC
  const chainId = await getChainId()
  if (chainId == '56') return

  const [deployer] = await ethers.getSigners()
  const token = await ethers.getContract<Token>('Token')
  const bridgeAssist = await ethers.getContract<BridgeAssist>('BridgeAssist')
  const balance = await token.balanceOf(deployer.address)

  await safeWrite(token.connect(deployer).transfer(bridgeAssist.address, balance))
})
export default func

func.tags = ['Token.setup']
func.dependencies = ['Token.deploy', 'BridgeAssist.deploy']
func.runAtTheEnd = true
