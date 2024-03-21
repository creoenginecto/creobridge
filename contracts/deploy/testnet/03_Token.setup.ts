import { ethers, getNamedAccounts } from 'hardhat'

import type { BridgeAssist, Token } from '@/typechain'

import { safeRead, safeWrite, setup } from '@/gotbit-tools/hardhat'
import { BigNumber } from 'ethers'

const func = setup('Token', async () => {
  const [deployer] = await ethers.getSigners()

  const token = await ethers.getContract<Token>('Token')
  const bridgeAssist = await ethers.getContract<BridgeAssist>('BridgeAssist')
  const tx = await token
    .connect(deployer)
    .transfer(bridgeAssist.address, ethers.utils.parseEther('100000000'), {
      gasPrice: BigNumber.from(20).mul(BigNumber.from(10).pow(9)),
    })
  await tx.wait()
  console.log('tx1 confirmed')

  const managerRole = await bridgeAssist.MANAGER_ROLE()
  const tx2 = await bridgeAssist
    .connect(deployer)
    .grantRole(managerRole, deployer.address, {
      gasPrice: BigNumber.from(20).mul(BigNumber.from(10).pow(9)),
    })
  await tx2.wait()
  console.log('tx2 confirmed')

  const tx3 = await bridgeAssist
    .connect(deployer)
    .addChains(['evm.97'], [0], {
      gasPrice: BigNumber.from(20).mul(BigNumber.from(10).pow(9)),
    })
  await tx3.wait()
  console.log('tx3 confirmed')
})
export default func

func.tags = ['Token.setup']
func.dependencies = ['Token.deploy', 'BridgeAssist.deploy']
func.runAtTheEnd = true
