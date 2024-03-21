import { ethers } from 'hardhat'

import type { BridgeAssist } from '@/typechain'

import { safeRead, safeWrite, setup } from '@/gotbit-tools/hardhat'

const func = setup('BridgeAssist', async () => {
  const [deployer] = await ethers.getSigners()
  const bridgeAssist = await ethers.getContract<BridgeAssist>('BridgeAssist')

  const MANAGER_ROLE = await safeRead(bridgeAssist.MANAGER_ROLE(), '')

  const [, txr] = await safeWrite(bridgeAssist.connect(deployer).grantRole(MANAGER_ROLE, deployer.address))

  const [, txr3] = await safeWrite(bridgeAssist.connect(deployer).addChains(["NEAR", "AVAX"], [9, 9]))

  console.log('gas used', txr!.gasUsed.toNumber() + txr3!.gasUsed.toNumber())
})
export default func

func.tags = ['BridgeAssist.setup']
func.dependencies = ['BridgeAssist.deploy']
func.runAtTheEnd = true
