import { ethers } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { BridgeAssist__factory, Token } from '@/typechain'

const func: DeployFunction = async (hre) => {
  const { deploy } = wrapperHRE(hre)
  const [deployer, relayer, , feeWallet] = await ethers.getSigners()

  const token = await ethers.getContract<Token>('Token')

  await deploy<BridgeAssist__factory>('BridgeAssist', {
    from: deployer.address,
    args: [
      token.address,
      ethers.utils.parseEther('100'),
      feeWallet.address,
      0,
      0,
      deployer.address,
      [relayer.address],
      1,
    ],
    estimateGasExtra: 120_000, // strings.toString is not estimated properly
    log: true,
  })
}
export default func

func.tags = ['BridgeAssist.deploy']
func.dependencies = ['Token.deploy']
