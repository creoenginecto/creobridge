import { ethers } from 'hardhat'
import type { DeployFunction } from 'hardhat-deploy/types'

import { wrapperHRE } from '@/gotbit-tools/hardhat'
import type { CreoEngine__factory } from '@/typechain'

const func: DeployFunction = async (hre) => {
  const { deploy } = wrapperHRE(hre)
  const [deployer] = await ethers.getSigners()

  // The token is already deployed on BSC
  const chainId = await hre.getChainId()
  if (chainId == '56') return

  await deploy<CreoEngine__factory>('Token', {
    contract: 'CreoEngine',
    from: deployer.address,
    args: ['CreoEngine', 'CREO', ethers.BigNumber.from(1000000000), deployer.address],
    log: true,
  })
}
export default func

func.tags = ['Token.deploy']
